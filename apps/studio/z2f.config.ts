// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { defineConfig } from '@zod-to-form/core';

// Component imports resolve relative to each schema/generated form module.
export default defineConfig({
  components: { source: './z2f-components', preset: 'shadcn', overrides: { Input: {} } },
  defaults: {
    mode: 'auto-save',
    ui: 'shadcn',
    optimization: { compileZod: false }
  }
});
