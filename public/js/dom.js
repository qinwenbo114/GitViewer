import { icon } from './icons.js';

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs != null && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
    children.unshift(attrs);
    attrs = null;
  }
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value == null || value === false) continue;
      if (key === 'class' || key === 'className') el.className = value;
      else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
      else if (key === 'dataset') Object.assign(el.dataset, value);
      else if (key === 'html') el.innerHTML = value;
      else if (key === 'ref' && typeof value === 'function') value(el);
      else if (key.startsWith('on') && typeof value === 'function') {
        el.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (['value', 'checked', 'disabled', 'selected', 'readOnly', 'indeterminate'].includes(key)) {
        el[key] = value;
      } else if (value === true) {
        el.setAttribute(key, '');
      } else {
        el.setAttribute(key, String(value));
      }
    }
  }
  append(el, children);
  return el;
}

function append(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    if (child instanceof Node) parent.append(child);
    else parent.append(document.createTextNode(String(child)));
  }
}

export function iconEl(name, size = 16, cls = '') {
  const span = document.createElement('span');
  span.className = 'icon-wrap ' + cls;
  span.innerHTML = icon(name, size);
  return span;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function qs(sel, root = document) {
  return root.querySelector(sel);
}

export function debounceInput(input, fn, wait = 280) {
  let timer = null;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(input.value), wait);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      clearTimeout(timer);
      fn(input.value);
    }
  });
}

let modalStack = [];
let toastSeq = 0;

export function openModal({
  title,
  body,
  footer,
  width = 520,
  dismissible = true,
  cls = '',
  onClose,
}) {
  const root = document.getElementById('modal-root');
  const backdrop = h('div', { class: 'modal-backdrop' });
  const box = h('div', { class: `modal ${cls}`, style: { width: `${width}px` }, role: 'dialog', 'aria-modal': 'true' });
  const closeBtn = h('button', {
    class: 'icon-btn modal-close',
    title: '关闭 (Esc)',
    html: icon('x', 16),
    onclick: () => close(false),
  });
  const header = h('div', { class: 'modal-header' },
    h('div', { class: 'modal-title' }, title),
    closeBtn);
  const bodyEl = h('div', { class: 'modal-body' });
  if (body) bodyEl.append(body);
  box.append(header, bodyEl);
  let footerEl = null;
  if (footer) {
    footerEl = h('div', { class: 'modal-footer' });
    if (Array.isArray(footer)) footerEl.append(...footer);
    else footerEl.append(footer);
    box.append(footerEl);
  }
  backdrop.append(box);
  root.append(backdrop);

  let closed = false;
  const entry = { close, backdrop };
  modalStack.push(entry);

  function close(result) {
    if (closed) return;
    closed = true;
    modalStack = modalStack.filter((m) => m !== entry);
    backdrop.classList.add('closing');
    setTimeout(() => backdrop.remove(), 120);
    document.removeEventListener('keydown', onKey);
    onClose?.(result);
  }
  function onKey(event) {
    if (event.key === 'Escape' && dismissible) {
      event.stopPropagation();
      close(false);
    }
  }
  document.addEventListener('keydown', onKey);
  if (dismissible) {
    backdrop.addEventListener('mousedown', (event) => {
      if (event.target === backdrop) close(false);
    });
  }
  const focusTarget = box.querySelector('input, textarea, select, button.primary, button:not(.modal-close)');
  setTimeout(() => {
    if (focusTarget && typeof focusTarget.focus === 'function') focusTarget.focus();
    if (focusTarget && focusTarget.tagName === 'INPUT' && focusTarget.type !== 'checkbox') focusTarget.select?.();
  }, 30);
  return { el: box, body: bodyEl, footer: footerEl, close, backdrop };
}

export function confirmDialog({
  title = '确认操作',
  message = '',
  detail = '',
  confirmText = '确定',
  cancelText = '取消',
  danger = false,
}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const body = h('div', { class: 'dialog-text' });
    if (message) body.append(h('p', {}, message));
    if (detail) body.append(h('p', { class: 'dialog-detail' }, detail));
    const cancel = h('button', {
      class: 'btn',
      onclick: () => { finish(false); modal.close(false); },
    }, cancelText);
    const ok = h('button', {
      class: `btn ${danger ? 'danger' : 'primary'}`,
      onclick: () => { finish(true); modal.close(true); },
    }, confirmText);
    const modal = openModal({
      title,
      body,
      footer: [cancel, ok],
      width: 460,
      onClose: () => finish(false),
    });
    setTimeout(() => ok.focus(), 40);
  });
}

export function promptDialog({
  title = '输入',
  label = '',
  value = '',
  placeholder = '',
  description = '',
  confirmText = '确定',
  cancelText = '取消',
  multiline = false,
  danger = false,
  validate = null,
}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (val) => {
      if (settled) return;
      settled = true;
      resolve(val);
    };
    const input = multiline
      ? h('textarea', { class: 'input', rows: 4, placeholder, value })
      : h('input', { class: 'input', type: 'text', placeholder, value });
    const error = h('div', { class: 'field-error' });
    const body = h('div', { class: 'dialog-form' });
    if (description) body.append(h('p', { class: 'dialog-detail' }, description));
    body.append(h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), input, error));
    const cancel = h('button', { class: 'btn', onclick: () => { finish(null); modal.close(null); } }, cancelText);
    const ok = h('button', {
      class: `btn ${danger ? 'danger' : 'primary'}`,
      onclick: submit,
    }, confirmText);
    const modal = openModal({
      title,
      body,
      footer: [cancel, ok],
      width: 520,
      onClose: () => finish(null),
    });
    function submit() {
      const val = input.value.trim();
      if (!val) {
        error.textContent = '此项不能为空';
        input.focus();
        return;
      }
      if (validate) {
        const msg = validate(val);
        if (msg) {
          error.textContent = msg;
          input.focus();
          return;
        }
      }
      finish(val);
      modal.close(val);
    }
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (!multiline || event.ctrlKey)) {
        event.preventDefault();
        submit();
      }
    });
    setTimeout(() => { input.focus(); input.select?.(); }, 40);
  });
}

export function formDialog({
  title = '',
  description = '',
  fields = [],
  submitText = '确定',
  cancelText = '取消',
  width = 560,
  danger = false,
}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (val) => {
      if (settled) return;
      settled = true;
      resolve(val);
    };
    const body = h('div', { class: 'dialog-form' });
    if (description) body.append(h('p', { class: 'dialog-detail' }, description));
    const inputs = new Map();
    for (const field of fields) {
      let input;
      if (field.type === 'checkbox') {
        input = h('input', { type: 'checkbox', checked: !!field.value });
      } else if (field.type === 'select') {
        input = h('select', { class: 'input' },
          ...(field.options || []).map((opt) =>
            h('option', { value: opt.value, selected: opt.value === field.value }, opt.label)));
      } else if (field.type === 'textarea') {
        input = h('textarea', { class: 'input', rows: field.rows || 4, placeholder: field.placeholder || '', value: field.value || '' });
      } else {
        input = h('input', {
          type: field.type || 'text',
          class: 'input',
          placeholder: field.placeholder || '',
          value: field.value || '',
          autocomplete: 'off',
        });
      }
      inputs.set(field.name, input);
      const label = h('label', { class: `field ${field.type === 'checkbox' ? 'checkbox-field' : ''}` });
      if (field.type === 'checkbox') {
        label.append(input, h('span', { class: 'field-label' }, field.label));
      } else {
        label.append(h('span', { class: 'field-label' }, field.label));
        label.append(input);
      }
      if (field.help) label.append(h('span', { class: 'field-help' }, field.help));
      body.append(label);
    }
    const error = h('div', { class: 'field-error' });
    body.append(error);
    const cancel = h('button', { class: 'btn', onclick: () => { finish(null); modal.close(null); } }, cancelText);
    const ok = h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, onclick: submit }, submitText);
    const modal = openModal({ title, body, footer: [cancel, ok], width, onClose: () => finish(null) });
    function submit() {
      const data = {};
      for (const field of fields) {
        const input = inputs.get(field.name);
        data[field.name] = field.type === 'checkbox' ? input.checked : input.value.trim();
        if (field.required && !data[field.name]) {
          error.textContent = `请填写「${field.label}」`;
          input.focus();
          return;
        }
      }
      finish(data);
      modal.close(data);
    }
    const first = body.querySelector('input:not([type=checkbox]), textarea, select');
    setTimeout(() => first?.focus(), 40);
  });
}

export function toast(message, type = 'info', opts = {}) {
  const root = document.getElementById('toast-root');
  const id = ++toastSeq;
  const iconName = type === 'success' ? 'check' : type === 'error' ? 'alert' : type === 'warn' ? 'warning' : 'info';
  const el = h('div', { class: `toast toast-${type}`, 'data-toast-id': id },
    h('span', { class: 'toast-icon', html: icon(iconName, 16) }),
    h('span', { class: 'toast-text' }, message));
  if (opts.action) {
    el.append(h('button', {
      class: 'toast-action',
      onclick: () => {
        opts.action.onClick();
        remove();
      },
    }, opts.action.label));
  }
  const close = h('button', { class: 'toast-close', title: '关闭', html: icon('x', 13), onclick: () => remove() });
  el.append(close);
  root.append(el);
  const duration = opts.duration ?? (type === 'error' ? 8000 : 3500);
  const timer = setTimeout(remove, duration);
  function remove() {
    clearTimeout(timer);
    if (!el.isConnected) return;
    el.classList.add('toast-out');
    setTimeout(() => el.remove(), 180);
  }
  while (root.children.length > 4) root.firstChild.remove();
  return remove;
}

export function errorDialog(error) {
  const message = error?.message || String(error || '未知错误');
  const stderr = error?.detail?.stderr || error?.stderr || '';
  const stdout = error?.detail?.stdout || error?.stdout || '';
  const command = error?.detail?.command || error?.command || '';
  const detailText = [
    command ? `$ ${command}` : '',
    stderr && stderr.trim(),
    stdout && stdout.trim() ? `--- stdout ---\n${stdout.trim()}` : '',
  ].filter(Boolean).join('\n\n').slice(0, 9000);
  const body = h('div', { class: 'dialog-text' },
    h('p', { class: 'error-message' }, message));
  if (detailText) {
    const pre = h('pre', { class: 'error-detail' }, detailText);
    const copy = h('button', {
      class: 'btn small',
      html: `${icon('copy', 14)}<span>复制详情</span>`,
      onclick: async () => {
        await copyText(detailText);
        toast('已复制错误详情', 'success');
      },
    });
    body.append(h('div', { class: 'error-detail-head' }, h('span', {}, '详细信息'), copy), pre);
  }
  const close = h('button', { class: 'btn primary' }, '关闭');
  const modal = openModal({ title: '操作失败', body, footer: [close], width: 620 });
  close.addEventListener('click', () => modal.close());
}

export function contextMenu(event, items) {
  event.preventDefault?.();
  event.stopPropagation?.();
  document.querySelectorAll('.context-menu').forEach((el) => el.remove());
  const menu = h('div', { class: 'context-menu', role: 'menu' });
  let focusable = [];
  for (const item of items) {
    if (!item) continue;
    if (item.separator) {
      menu.append(h('div', { class: 'menu-separator' }));
      continue;
    }
    const btn = h('button', {
      class: `menu-item ${item.danger ? 'danger' : ''}`,
      disabled: !!item.disabled,
      title: item.title || '',
      role: 'menuitem',
      onclick: (ev) => {
        ev.stopPropagation();
        close();
        item.onClick?.();
      },
    },
    h('span', { class: 'menu-icon', html: item.icon ? icon(item.icon, 15) : '' }),
    h('span', { class: 'menu-label' }, item.label),
    item.shortcut ? h('span', { class: 'menu-shortcut' }, item.shortcut) : null);
    menu.append(btn);
    if (!item.disabled) focusable.push(btn);
  }
  document.getElementById('menu-root').append(menu);
  const rect = menu.getBoundingClientRect();
  const x = Math.min(event.clientX ?? 40, window.innerWidth - rect.width - 8);
  const y = Math.min(event.clientY ?? 40, window.innerHeight - rect.height - 8);
  menu.style.left = `${Math.max(8, x)}px`;
  menu.style.top = `${Math.max(8, y)}px`;
  menu.tabIndex = -1;
  menu.focus();

  function close() {
    menu.remove();
    document.removeEventListener('mousedown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('blur', close);
  }
  function onDown(ev) {
    if (!menu.contains(ev.target)) close();
  }
  function onKey(ev) {
    if (ev.key === 'Escape') {
      ev.stopPropagation();
      close();
    } else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      const idx = focusable.indexOf(document.activeElement);
      const delta = ev.key === 'ArrowDown' ? 1 : -1;
      const next = focusable[(idx + delta + focusable.length) % focusable.length];
      next?.focus();
    }
  }
  setTimeout(() => {
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', close);
  }, 0);
  return menu;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = h('textarea', { style: { position: 'fixed', top: '-1000px' } });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

export function emptyState({ iconName = 'git', title, description, actions = [], compact = false }) {
  return h('div', { class: `empty-state ${compact ? 'compact' : ''}` },
    h('div', { class: 'empty-icon', html: icon(iconName, compact ? 26 : 38) }),
    h('div', { class: 'empty-title' }, title),
    description ? h('div', { class: 'empty-desc' }, description) : null,
    actions.length ? h('div', { class: 'empty-actions' }, ...actions) : null);
}

export function loadingState(text = '加载中…') {
  return h('div', { class: 'loading-state' },
    h('span', { class: 'spinner' }),
    h('span', {}, text));
}

export function button(label, { iconName, variant = '', onClick, title, disabled, size = '' } = {}) {
  return h('button', {
    class: `btn ${variant} ${size}`.trim(),
    title: title || label,
    disabled,
    onclick: onClick,
    html: `${iconName ? icon(iconName, size === 'small' ? 13 : 15) : ''}${label ? `<span>${label}</span>` : ''}`,
  });
}

export const busy = {
  count: 0,
  begin(label = '处理中…') {
    this.count++;
    document.body.classList.add('is-busy');
    const bar = document.getElementById('global-progress');
    if (bar) {
      bar.classList.add('active');
      const text = bar.querySelector('.progress-label');
      if (text) text.textContent = label;
    }
  },
  end() {
    this.count = Math.max(0, this.count - 1);
    if (this.count === 0) {
      document.body.classList.remove('is-busy');
      document.getElementById('global-progress')?.classList.remove('active');
    }
  },
};
