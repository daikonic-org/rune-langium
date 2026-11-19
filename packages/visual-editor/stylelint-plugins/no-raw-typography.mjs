// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import stylelint from 'stylelint';

const ruleName = 'rune/no-raw-typography';
const messages = stylelint.utils.ruleMessages(ruleName, {
  family: 'Use var(--font-title|body|mono|code) for font-family.',
  weight: 'Use a var(--font-weight-*) token for font-weight.',
  shorthand: 'Use token-based font-family, font-size and font-weight longhands instead of font shorthand.'
});
const cascadeKeyword = /^(inherit|initial|unset|revert|revert-layer)$/i;
const familyToken = /^var\(\s*--font-(title|body|mono|code)\s*\)$/;
const weightToken = /^var\(\s*--font-weight-[a-z-]+\s*\)$/;

const rule = (primary) => (root, result) => {
  if (!stylelint.utils.validateOptions(result, ruleName, { actual: primary, possible: [true] })) return;

  root.walkDecls((decl) => {
    const prop = decl.prop.toLowerCase();
    if (prop.startsWith('--') || cascadeKeyword.test(decl.value.trim())) return;
    // Face registrations describe actual font files, rather than selecting UI fonts.
    for (let parent = decl.parent; parent; parent = parent.parent) {
      if (parent.type === 'atrule' && parent.name.toLowerCase() === 'font-face') return;
    }
    let message;
    if (prop === 'font-family' && !familyToken.test(decl.value.trim())) message = messages.family;
    else if (prop === 'font-weight' && !weightToken.test(decl.value.trim())) message = messages.weight;
    else if (prop === 'font') message = messages.shorthand;
    if (message) stylelint.utils.report({ message, node: decl, result, ruleName });
  });
};

rule.ruleName = ruleName;
rule.messages = messages;

export default stylelint.createPlugin(ruleName, rule);
