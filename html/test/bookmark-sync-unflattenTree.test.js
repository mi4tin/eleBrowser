const assert = require('node:assert/strict');
const BookmarkSync = require('../bookmarks/bookmark-sync.js');
const { json } = require('node:stream/consumers');

global.localStorage = global.localStorage || {
    _store: new Map(),
    getItem(key) {
        return this._store.has(key) ? this._store.get(key) : null;
    },
    setItem(key, value) {
        this._store.set(key, String(value));
    }
};

const bookmarkSync = new BookmarkSync({
    id: 'root',
    title: '书签',
    type: 'folder',
    items: []
});

const flatList = JSON.parse(`[
    {
        "localId": "root-b4lpkq",
        "parentId": "",
        "type": "folder",
        "title": "222",
        "url": "",
        "favicon": "",
        "orderIndex": 0,
        "syncVersion": 1,
        "isDeleted": false
    },
    {
        "localId": "local-1777277889519-mztlfx",
        "parentId": "root-b4lpkq",
        "type": "bookmark",
        "title": "倔金",
        "url": "https://juejin.cn/",
        "favicon": "🔗",
        "orderIndex": 0,
        "syncVersion": 1,
        "isDeleted": false
    }
]`);


const cloudList = JSON.parse(`[
    {
        "localId": "root-9ddzjv",
        "parentId": "",
        "type": "folder",
        "title": "222",
        "url": "",
        "favicon": "",
        "orderIndex": 0,
        "syncVersion": 2,
        "isDeleted": false
    },
    {
        "localId": "local-1777271147744-gcgmbp",
        "parentId": "root-9ddzjv",
        "type": "bookmark",
        "title": "中国经济网",
        "url": "http://www.ce.cn/",
        "favicon": "🔗",
        "orderIndex": 0,
        "syncVersion": 2,
        "isDeleted": false
    },
    {
        "localId": "local-1777271147744-y1057i",
        "parentId": "",
        "type": "bookmark",
        "title": "中国军事",
        "url": "https://military.china.com/",
        "favicon": "🔗",
        "orderIndex": 0,
        "syncVersion": 2,
        "isDeleted": false
    }
]`);

// const tree = bookmarkSync.unflattenTree(flatList);
// console.log(JSON.stringify(tree, null, 2));

console.log('----------------------');

const mergedTree = bookmarkSync.mergeBookmarks(flatList, flatList);
console.log(JSON.stringify(mergedTree, null, 2));   
