function getUrlInfo(dataTransfer) {
  let url = '';
  let title = '';
  
  // 尝试获取 URL（text/uri-list 或 text/plain）
  if (dataTransfer.types.includes('text/uri-list')) {
    url = dataTransfer.getData('text/uri-list');
  } else if (dataTransfer.types.includes('text/plain')) {
    url = dataTransfer.getData('text/plain');
  }

  // 尝试获取标题（仅当拖拽内容包含 HTML 时可能解析到）
  if (dataTransfer.types.includes('text/html')) {
    const html = dataTransfer.getData('text/html');
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const a = doc.querySelector('a');
    if (a) {
      title = a.textContent || a.title || '';
      title = title.trim();
    }
  }
  return { title, url };
}

// 生成书签ID
function generateBookmarkId(url) {
    return murmur3(url);
}

//生成一个长度低于32位的指定字符串，与str一一对应
// 速度比md5快很多，见https://chat.deepseek.com/a/chat/s/6bdfbb63-2851-49b3-9114-86ee43f54304
//使用示例：murmur3('123'),可以不传seed
function murmur3(str, seed = 0) {
        let h1 = seed | 0;
        const c1 = 0xcc9e2d51, c2 = 0x1b873593;
        
        for (let i = 0; i < str.length; i++) {
            let k1 = str.charCodeAt(i);
            k1 = Math.imul(k1, c1);
            k1 = (k1 << 15) | (k1 >>> 17);
            k1 = Math.imul(k1, c2);
            h1 ^= k1;
            h1 = (h1 << 13) | (h1 >>> 19);
            h1 = Math.imul(h1, 5) + 0xe6546b64 | 0;
        }
        
        h1 ^= str.length;
        h1 ^= h1 >>> 16;
        h1 = Math.imul(h1, 0x85ebca6b);
        h1 ^= h1 >>> 13;
        h1 = Math.imul(h1, 0xc2b2ae35);
        h1 ^= h1 >>> 16;
        
        return (h1 >>> 0).toString(36);
    }