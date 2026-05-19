const registerAppIpcHandlers = require('./app');
const registerBookmarksIpcHandlers = require('./bookmarks');
const registerSearchPanelIpcHandlers = require('./searchPanel');
const registerHistoryIpcHandlers = require('./history');
const registerLoginIpcHandlers = require('./login');
const registerDownloadsIpcHandlers = require('./downloads');
const registerDialogIpcHandlers = require('./dialog');
const registerPasswordManagerIpcHandlers = require('./passwordManager');

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
    registerDialogIpcHandlers(deps);
    const passwordManager = registerPasswordManagerIpcHandlers(deps);
    
    return { bookmarks, downloads, passwordManager };
};
