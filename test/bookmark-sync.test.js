const assert = require('node:assert/strict');
const BookmarkSync = require('../html/bookmarks/bookmark-sync.js');

global.localStorage = {
    _store: new Map(),
    getItem(key) {
        return this._store.has(key) ? this._store.get(key) : null;
    },
    setItem(key, value) {
        this._store.set(key, String(value));
    },
    removeItem(key) {
        this._store.delete(key);
    }
};

function runMergeBookmarksTest() {
    const bookmarkSync = new BookmarkSync({
        id: 'root',
        title: '书签',
        name: '书签',
        type: 'folder',
        items: []
    });

    const localTree = {
        id: 'root',
        title: '本地根目录',
        name: '本地根目录',
        type: 'folder',
        items: [
            {
                id: 'shared-folder',
                parentId: 'root',
                title: '本地旧目录',
                name: '本地旧目录',
                type: 'folder',
                orderIndex: 5,
                items: [
                    {
                        id: 'local-only-bookmark',
                        parentId: 'shared-folder',
                        title: '本地新增书签',
                        name: '本地新增书签',
                        type: 'bookmark',
                        url: 'https://local-only.example.com',
                        orderIndex: 1
                    }
                ]
            },
            {
                id: 'local-only-folder',
                parentId: 'root',
                title: '仅本地目录',
                name: '仅本地目录',
                type: 'folder',
                orderIndex: 9,
                items: []
            }
        ]
    };

    const cloudTree = {
        id: 'root',
        title: '云端根目录',
        name: '云端根目录',
        type: 'folder',
        items: [
            {
                id: 'shared-folder',
                parentId: 'root',
                title: '云端目录',
                name: '云端目录',
                type: 'folder',
                orderIndex: 0,
                items: [
                    {
                        id: 'cloud-bookmark',
                        parentId: 'shared-folder',
                        title: '云端书签',
                        name: '云端书签',
                        type: 'bookmark',
                        url: 'https://cloud.example.com',
                        orderIndex: 0
                    }
                ]
            }
        ]
    };

    const mergedTree = bookmarkSync.mergeBookmarks(localTree, cloudTree);
    console.log('mergedTree', mergedTree);

    assert.equal(mergedTree.id, 'root');
    assert.equal(mergedTree.title, '云端根目录');
    assert.equal(mergedTree.items.length, 2);

    const sharedFolder = mergedTree.items.find(item => item.id === 'shared-folder');
    assert.ok(sharedFolder, '应保留共享目录');
    assert.equal(sharedFolder.title, '云端目录');
    assert.equal(sharedFolder.items.length, 2);
    assert.deepEqual(
        sharedFolder.items.map(item => item.id),
        ['cloud-bookmark', 'local-only-bookmark'],
        '共享目录下应保留云端内容，并追加本地独有内容'
    );

    const localOnlyFolder = mergedTree.items.find(item => item.id === 'local-only-folder');
    assert.ok(localOnlyFolder, '应保留本地独有目录');
    assert.equal(localOnlyFolder.title, '仅本地目录');
}

runMergeBookmarksTest();
console.log('bookmark-sync mergeBookmarks test passed');
