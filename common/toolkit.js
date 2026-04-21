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