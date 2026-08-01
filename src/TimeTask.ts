import timezones from './timezones.json'
const conversion = {
    day: 1000 * 60 * 60 * 24,
    hour: 1000 * 60 * 60,
    minute: 1000 * 60,
    second: 1000,
    millisecond: 1,
};

const conversionKeys = Object.keys(conversion);

interface TimePoint {
    hours: number;
    minutes: number;
    seconds: number;
    milliseconds: number;
}

type TimeTaskState = 'INITIALIZED' | 'PENDING' | 'STARTED' | 'FINISHED' | 'CANCELLED';

class TimeTask {
    #time_point: TimePoint;
    #timezone!: string;
    #timeout: ReturnType<typeof setTimeout> | undefined;
    #interval!: ReturnType<typeof setInterval> | undefined;
    #tasks: (() => void)[] = [];
    #repeat_interval = conversion.day; // Default is 24 hours
    #repeat_count = 0;
    #state: TimeTaskState = 'INITIALIZED'; // [INITIALIZED, PENDING, STARTED, FINISHED, CANCELLED]
    #next_execution: number | undefined;
    #finish_handler: (() => void) | undefined;

    constructor(time_string: string) {
        this.#time_point = this.#parse_time_string(time_string);
    }

    /**
     * Sets the timezone for current TimeTask instance to target for scheduling purposes.
     *
     * @param {String} timezone
     */
    inTimezone(timezone: string): this {
        // Ensure timezone is a string type
        if (typeof timezone !== 'string')
            throw new Error(
                '.inTimezone(timezone) -> timezone must be a String type.'
            );

        this.#timezone = timezone;
        return this;
    }

    /**
     * Adds task to TimeTask to be executed upon specified time.
     *
     * @param {Function} task
     */
    do(task: () => void): this {
        // Ensure task is a function type
        if (typeof task !== 'function')
            throw new Error('.do(task) -> task must be a Function');

        // Ensure task is not already started
        if (this.#state !== 'INITIALIZED' && this.#state !== 'PENDING')
            throw new Error(
                'You cannot do() more work once a TimeTask has been started or CANCELLED.'
            );

        // Queue the task for future execution
        this.#tasks.push(task);
        this.#schedule();
        return this;
    }

    /**
     * Makes current TimeTask repeat specified amount of times. Note! this method is only available for isEqualTo time tasks.
     *
     * @param {Number} amount
     */
    repeat(amount: number = Infinity): this {
        // Do not allow repetitions if a finish handler has been set
        if (this.#finish_handler && amount === Infinity)
            throw new Error(
                'repeat(amount) -> This method is not allowed after setting a whenFinished() handler.'
            );

        this.#repeat_count = amount;
        return this;
    }

    /**
     * Makes current TimeTask repeat after specified interval
     *
     * @param {String} interval_string
     */
    every(interval_string: string): this {
        let milliseconds = this.#parse_interval_string(interval_string);
        this.#repeat_interval = milliseconds;
        return this;
    }

    /**
     * Binds a handler which is called once the current TimeTask is fully complete and all scheduled repetitions have been completed.
     *
     * @param {Function} handler
     * @returns
     */
    whenFinished(handler: () => void): this {
        // Only allow function type handler
        if (typeof handler !== 'function')
            throw new Error(
                'whenFinished(handler) -> handler must be a Function.'
            );

        // Do not allow whenFinished to be set if repetitions are enabled
        if (this.#repeat_count === Infinity)
            throw new Error(
                'whenFinished(handler) -> This function will never finish as it has infinite repeats scheduled.'
            );

        this.#finish_handler = handler;
        return this;
    }

    /**
     * Stops current TimeTask and cleans up any associated timeouts or intervals.
     * Instance can successfully be cleaned up after being CANCELLED.
     */
    cancel(): void {
        this.#finish('CANCELLED');
    }

    /**
     * Wraps input number inside the specified limit number
     *
     * @param {Number} input
     * @param {Number} limit
     * @returns {Number} Number
     */
    #wrap_number(input: number, limit: number): number {
        return input > limit
            ? input % limit
            : input < 0
                ? (input % limit) + limit
                : input;
    }

    /**
     * Parses time string into an object of hours, minutes, seconds and milliseconds.
     *
     * @param {String} time_string
     * @returns {Object} Object
     */
    #parse_time_string(time_string: string): TimePoint {
        // Ensure time_string is a string
        if (typeof time_string !== 'string')
            throw new Error('time_string must be a string type');

        // Enforce lowercase time_string format
        time_string = time_string.toLowerCase();

        // Determine timeslot for the time format
        let isPM = time_string.endsWith(' pm');

        // Parse the pre-chunk of a date
        let pre_chunk = time_string.split(' ')[0];
        if (pre_chunk.indexOf(':') > -1) {
            let chunks = pre_chunk.split(':');
            let hours = +chunks[0];
            if (chunks.length > 0 && !isNaN(hours)) {
                // Wrap hours to a maximum of 24 hours
                hours = this.#wrap_number(hours, 24);

                // Relativize 12 hour format into a 24 hour format
                if (hours < 12 && isPM) hours += 12;

                // Return wrapped breakdown of the time point in 24 hour format
                return {
                    hours: hours,
                    minutes: this.#wrap_number(+(chunks[1] || 0), 60),
                    seconds: this.#wrap_number(+(chunks[2] || 0), 60),
                    milliseconds: this.#wrap_number(+(chunks[3] || 0), 1000),
                };
            }
        }

        // Throw error on failed parsing
        throw new Error(
            'time_string is not a valid time string. Must be Hours:Minutes:Seconds:Milliseconds AM/PM'
        );
    }

    /**
     * Parses human readable interval string into the milliseconds amount.
     *
     * @param {String} interval_string
     * @returns {Number} Milliseconds
     */
    #parse_interval_string(interval_string: string): number {
        let chunks = interval_string.split(' ');
        if (chunks.length == 2) {
            let amount = +chunks[0];
            let metric = chunks[1].toLowerCase();
            if (!isNaN(amount)) {
                let valid_metric = false;
                conversionKeys.forEach((key) => {
                    if (metric.startsWith(key)) {
                        valid_metric = true;
                        amount *= conversion[key as keyof typeof conversion];
                    }
                });
                if (valid_metric) return amount;
            }
        }

        throw new Error(
            'Invalid interval_string. Please specify a time string such as "5 hours" or "10 seconds"'
        );
    }

    /**
     * Returns current time point in specified timezone string.
     *
     * @param {String} tz Timezone String
     * @returns {Object} Object
     */
    #current_time_tz(tz: string): TimePoint {
        // Generate local and nativized date
        let date = new Date();
        let native = date.toLocaleTimeString('en-US', {
            timeZone: tz,
        });

        // Determine nativized hours and convert to 24 hour format
        let hours = +native.split(':')[0];
        let isPM = native.endsWith('PM');
        return {
            hours: hours + (isPM ? 12 : 0),
            minutes: date.getMinutes(),
            seconds: date.getSeconds(),
            milliseconds: date.getMilliseconds(),
        };
    }

    /**
     * Returns current time point.
     *
     * @returns {Object} Object
     */
    #current_time(): TimePoint {
        // Use timzone specific method if a timezone is specified
        if (this.#timezone) return this.#current_time_tz(this.#timezone);

        let date = new Date();
        return {
            hours: date.getHours(),
            minutes: date.getMinutes(),
            seconds: date.getSeconds(),
            milliseconds: date.getMilliseconds(),
        };
    }

    /**
     * Converts time point into milliseconds.
     *
     * @param {Object} point
     * @returns {Number}
     */
    #point_to_milliseconds(point: TimePoint): number {
        return (
            point.hours * conversion.hour +
            point.minutes * conversion.minute +
            point.seconds * conversion.second +
            point.milliseconds * conversion.millisecond
        );
    }

    /**
     * Returns the offset in milliseconds till next execution time.
     *
     * @returns {Number}
     */
    #execution_offset(): number {
        let current = this.#current_time();
        let future = this.#time_point;
        let current_msecs = this.#point_to_milliseconds(current);
        let future_msecs = this.#point_to_milliseconds(future);

        // Return milliseconds till next time hit
        if (current_msecs < future_msecs) {
            return future_msecs - current_msecs;
        } else {
            return conversion.day - current_msecs + future_msecs;
        }
    }

    /**
     * Schedules the first task execution based on offset to next time point
     */
    #schedule(): void {
        // Do not reschedule once TimeTask is in pending state
        if (this.#state == 'PENDING') return;

        // Create a timeout with determined offset to perform first execution
        let offset = this.#execution_offset();
        this.#state = 'PENDING';
        this.#next_execution = Date.now() + offset;
        this.#timeout = setTimeout(
            (reference: TimeTask) => {
                reference.#execute(true);
                reference.#timeout = undefined;
            },
            offset,
            this
        );
    }

    /**
     * Repeats time task execution and offsets pending repetitions.
     */
    #repeat(): void {
        // Execute all tasks
        this.#execute();

        // Calculate if more repetitions are pending and finish if no more pending repetitions remain
        this.#repeat_count--;
        if (this.#repeat_count < 1 && this.#state == 'STARTED') {
            this.#finish();
        } else {
            // Update next execution timestamp
            this.#next_execution = Date.now() + this.#repeat_interval;
        }
    }

    /**
     * Performs Time Task execution and repeats if neccessary
     */
    #execute(first_time: boolean = false): void {
        // Handle first time execution for future setup
        if (first_time) {
            // Update the task state to started upon first execution
            this.#state = 'STARTED';

            // Bind interval to repeat task if repetitions are specified
            if (this.#repeat_count > 1) {
                this.#repeat_count--;
                this.#next_execution = Date.now() + this.#repeat_interval;
                this.#interval = setInterval(
                    (task: TimeTask) => task.#repeat(),
                    this.#repeat_interval,
                    this
                );
            }
        }

        // Execute all instance tasks
        this.#tasks.forEach((task) => task());

        // Finish after first execution if no repetitions are pending
        if (this.#repeat_count < 1) this.#finish();
    }

    /**
     * Destroys current TimeTask instance and removes any underlying intervals/timeouts.
     *
     * @param {String} state
     */
    #finish(state: TimeTaskState = 'FINISHED'): void {
        if (this.#timeout) clearTimeout(this.#timeout);
        if (this.#interval) clearInterval(this.#interval);
        this.#tasks = [];
        this.#state = state;

        // Trigger finish handler if state is finished
        if (state === 'FINISHED' && this.#finish_handler)
            this.#finish_handler();
    }

    /* TimeTask Getters */
    get next_execution(): number | undefined {
        return this.#next_execution;
    }

    get tasks(): (() => void)[] {
        return this.#tasks;
    }

    get remaining(): number {
        return this.#repeat_count;
    }

    get state(): TimeTaskState {
        return this.#state;
    }
}

export default TimeTask;
