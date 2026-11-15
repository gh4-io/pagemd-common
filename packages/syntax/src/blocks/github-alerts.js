/**
 * GitHub alerts: > [!NOTE], > [!TIP], > [!IMPORTANT], > [!WARNING], > [!CAUTION]
 */

import markdownItGithubAlerts from 'markdown-it-github-alerts';
import { writeAlert } from './github-alerts-write.js';

/** @type {import('../index.js').SyntaxItemDef} */
export default {
  id: 'github-alerts',
  group: 'blocks',
  read(md) {
    md.use(markdownItGithubAlerts);
  },
  write: writeAlert,
  htmlContract: ['<div class="markdown-alert markdown-alert-{type}"><p class="markdown-alert-title">…</p>…</div>'],
  params: [
    { key: 'type', type: 'enum', values: ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION'] }
  ]
};
