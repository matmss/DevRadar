/**
 * Splits a comma-separated list, trimming each entry and dropping empty ones.
 * @param {string} arrayAsString - e.g. "node, react"
 * @returns {string[]}
 */
module.exports = function parseStringAsArray(arrayAsString) {
    return arrayAsString
        .split(',')
        .map(tech => tech.trim())
        .filter(tech => tech !== '');
}
