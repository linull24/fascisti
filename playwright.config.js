const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  use: {
    channel: 'chrome',
    headless: true,
  },
});
