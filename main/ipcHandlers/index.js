const registerAppIpcHandlers = require('./app');
const registerBookmarksIpcHandlers = require('./bookmarks');
const registerSearchPanelIpcHandlers = require('./searchPanel');
const registerHistoryIpcHandlers = require('./history');
const registerLoginIpcHandlers = require('./login');
const registerDownloadsIpcHandlers = require('./downloads');

module.exports = function registerIpcHandlers(deps) {
    const downloads = registerDownloadsIpcHandlers(deps);
    
    registerAppIpcHandlers({
        ...deps,
        getDownloadsApi: deps.getDownloadsApi
    });
    
    registerSearchPanelIpcHandlers(deps);
    registerHistoryIpcHandlers(deps);
    registerLoginIpcHandlers(deps);
    const bookmarks = registerBookmarksIpcHandlers({ ...deps, hideDownloadsPanel: downloads.hideDownloadsPanel });
    
    return { bookmarks, downloads };
};
