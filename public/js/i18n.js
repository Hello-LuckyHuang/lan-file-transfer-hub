class I18nManager {
  constructor() {
    this.locale = 'zh_cn';
    this.messages = {};
    this.fallbackMessages = {};
    this.supportedLocales = ['zh_cn', 'en_us'];
  }

  normalizeLocale(locale) {
    const normalized = String(locale || '').toLowerCase().replace('-', '_');
    if (normalized.startsWith('zh')) return 'zh_cn';
    if (normalized.startsWith('en')) return 'en_us';
    return this.supportedLocales.includes(normalized) ? normalized : 'zh_cn';
  }

  async loadLocale(locale) {
    const response = await fetch(`locales/${locale}.json`);
    if (!response.ok) {
      throw new Error(`Failed to load locale ${locale}`);
    }
    return response.json();
  }

  async init() {
    const browserLocale = this.normalizeLocale(navigator.language || 'zh_cn');
    const savedLocale = this.normalizeLocale(localStorage.getItem('locale') || browserLocale);
    this.fallbackMessages = await this.loadLocale('zh_cn');
    await this.setLocale(savedLocale, false);
  }

  async setLocale(locale, persist = true) {
    const normalized = this.normalizeLocale(locale);
    this.messages = await this.loadLocale(normalized);
    this.locale = normalized;
    if (persist) {
      localStorage.setItem('locale', normalized);
    }
    document.documentElement.lang = normalized === 'en_us' ? 'en-US' : 'zh-CN';
    this.applyTranslations();
  }

  getLocale() {
    return this.locale;
  }

  resolveMessage(key, source) {
    return key.split('.').reduce((acc, part) => (acc && acc[part] !== undefined ? acc[part] : undefined), source);
  }

  formatMessage(template, variables = {}) {
    if (typeof template !== 'string') return '';
    return template.replace(/\{(\w+)\}/g, (_, name) => {
      if (Object.prototype.hasOwnProperty.call(variables, name)) {
        return String(variables[name]);
      }
      return `{${name}}`;
    });
  }

  t(key, variables = {}) {
    const message = this.resolveMessage(key, this.messages);
    if (typeof message === 'string') {
      return this.formatMessage(message, variables);
    }

    const fallback = this.resolveMessage(key, this.fallbackMessages);
    if (typeof fallback === 'string') {
      return this.formatMessage(fallback, variables);
    }

    return key;
  }

  applyTranslations(root = document) {
    root.querySelectorAll('[data-i18n]').forEach((element) => {
      const key = element.getAttribute('data-i18n');
      element.textContent = this.t(key);
    });

    root.querySelectorAll('[data-i18n-placeholder]').forEach((element) => {
      const key = element.getAttribute('data-i18n-placeholder');
      element.setAttribute('placeholder', this.t(key));
    });

    root.querySelectorAll('[data-i18n-title]').forEach((element) => {
      const key = element.getAttribute('data-i18n-title');
      element.setAttribute('title', this.t(key));
    });

    root.querySelectorAll('[data-i18n-aria-label]').forEach((element) => {
      const key = element.getAttribute('data-i18n-aria-label');
      element.setAttribute('aria-label', this.t(key));
    });
  }
}
