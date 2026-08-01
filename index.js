import TimeTask from "./src/TimeTask";

/**
 * Returns a TimeTask instance with equalTo mode for the time point.
 *
 * @param {String} time_string
 * @returns {TimeTask} TimeTask
 */
function isEqualTo(time_string) {
    return new TimeTask(time_string);
}

export default {
    isEqualTo: isEqualTo,
};
