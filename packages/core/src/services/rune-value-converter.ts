// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { AstUtils, DefaultValueConverter, GrammarAST, type CstNode, type ValueType } from 'langium';

export class RuneValueConverter extends DefaultValueConverter {
  protected override runConverter(rule: GrammarAST.AbstractRule, input: string, node: CstNode): ValueType {
    if (rule.name === 'INT') {
      const parent = AstUtils.getContainerOfType(node.grammarSource, GrammarAST.isParserRule);
      // Langium concatenates converted tokens inside datatype rules. Keep
      // digits intact until the complete literal is converted.
      if (parent?.name === 'BigDecimal' || parent?.name === 'Integer') return input;
    }
    return super.runConverter(rule, input, node);
  }
}
