const paths = {
  mixed: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><path d="M14 17.5h7m-3.5-3.5v7"/>',
  listen: '<path d="M4 14v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="12" width="4" height="8" rx="2"/><rect x="17" y="12" width="4" height="8" rx="2"/>',
  write: '<path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14zM13 21h8"/>',
  read: '<path d="M12 5v16M12 5C9 3 5 3 2 4v15c4-1 7-1 10 2 3-3 6-3 10-2V4c-3-1-7-1-10 1Z"/>',
  profile: '<circle cx="12" cy="7" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  words: '<path d="m3 19 5-14 5 14M5 14h6m5-6h5m-5 5h4m-4 5h5"/>',
  grammar: '<path d="M5 4h14v16H5zM8 8h8M8 12h5m-5 4h8"/>',
  history: '<path d="M3 11a9 9 0 1 1 2 7M3 4v7h7m2-5v6l4 2"/>',
  settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
};
export const icon = name => `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.mixed}</svg>`;
export const skillIcon = { 阅读: 'read', 听力: 'listen', 表达: 'write', 词汇: 'words', 语法: 'grammar' };
export const modeName = name => ({ 对话: '写作', 题卡: '题卡（旧版）' }[name] || name);
