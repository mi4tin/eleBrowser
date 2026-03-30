const registerAppIpcHandlers = require('./app');
const registerBookmarksIpcHandlers = require('./bookmarks');
const registerSearchPanelIpcHandlers = require('./searchPanel');
const registerHistoryIpcHandlers = require('./history');

module.exports = function registerIpcHandlers(deps) {
    registerAppIpcHandlers(deps);
    registerSearchPanelIpcHandlers(deps);
    registerHistoryIpcHandlers(deps);
    const bookmarks = registerBookmarksIpcHandlers(deps);
    return { bookmarks };
};
