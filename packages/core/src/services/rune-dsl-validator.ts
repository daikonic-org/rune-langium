// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import type { ValidationAcceptor, ValidationChecks, LangiumCoreServices } from 'langium';
import { namespaceOverrideDiagnostics } from '../references/project-resolution.js';
import {
  isRosettaFeatureCall,
  isRosettaDeepFeatureCall,
  isRosettaConditionalExpression,
  isRosettaOnlyExistsExpression,
  isLogicalOperation,
  isComparisonOperation,
  isEqualityOperation,
  isArithmeticOperation,
  isRosettaContainsExpression,
  isRosettaDisjointExpression,
  isRosettaConstructorExpression,
  isSwitchOperation,
  isRosettaFunction,
  isAnnotation,
  isChoiceOption
} from '../generated/ast.js';
import type {
  Data,
  Attribute,
  RosettaFunction,
  RosettaEnumeration,
  Choice,
  RosettaModel,
  Condition,
  ChoiceOption,
  RosettaEnumValue,
  ShortcutDeclaration,
  Operation,
  RosettaRule,
  RosettaExpression,
  Import
} from '../generated/ast.js';

type RuneDslAstType = {
  Data: Data;
  Attribute: Attribute;
  RosettaFunction: RosettaFunction;
  RosettaEnumeration: RosettaEnumeration;
  Choice: Choice;
  RosettaModel: RosettaModel;
  Condition: Condition;
  ChoiceOption: ChoiceOption;
  RosettaEnumValue: RosettaEnumValue;
  ShortcutDeclaration: ShortcutDeclaration;
  Operation: Operation;
  RosettaRule: RosettaRule;
  Import: Import;
  RosettaExpression: RosettaExpression;
};

/**
 * Custom validator for the Rune DSL.
 *
 * Implements structural, naming, expression, and reporting validations
 * ported from the original Xtext implementation.
 *
 * Rule categories:
 * - S-##: Structural constraints (duplicates, cycles, missing fields)
 * - N-##: Naming convention rules
 * - E-##: Expression validation rules
 * - R-##: Reporting validation rules
 */
export class RuneDslValidator {
  /**
   * Register validation checks with the Langium validation registry.
   */
  registerChecks(services: LangiumCoreServices): void {
    const registry = services.validation.ValidationRegistry;
    const checks: ValidationChecks<RuneDslAstType> = {
      Data: [
        this.checkDataNoDuplicateAttributes,
        this.checkDataExtendsCycle,
        this.checkDataNaming,
        this.checkDataAttributeOverrideValid,
        this.checkDataMustHaveAttributesOrSuperType
      ],
      Attribute: [this.checkAttributeCardinality, this.checkAttributeNaming],
      RosettaFunction: [
        this.checkFunctionNoDuplicateInputs,
        this.checkFunctionOutputRequired,
        this.checkFunctionNaming,
        this.checkFunctionNoDuplicateShortcuts,
        this.checkFunctionNoDuplicateConditions
      ],
      RosettaEnumeration: [
        this.checkEnumNoDuplicateValues,
        this.checkEnumNaming,
        this.checkEnumExtendsCycle,
        this.checkEnumValueNaming
      ],
      Choice: [this.checkChoiceNoDuplicateOptions, this.checkChoiceNaming, this.checkChoiceMinOptions],
      RosettaModel: [
        this.checkModelNoDuplicateElements,
        this.checkModelNamespaceValid,
        (model, accept) => {
          for (const issue of namespaceOverrideDiagnostics(services, model))
            accept('error', issue.message, { node: issue.node, code: issue.code });
        }
      ],
      Condition: [this.checkConditionNaming, this.checkConditionHasExpression],
      ChoiceOption: [],
      RosettaEnumValue: [this.checkEnumValueNamingRule],
      ShortcutDeclaration: [this.checkShortcutNaming, this.checkShortcutHasExpression],
      Operation: [this.checkOperationHasExpression],
      RosettaRule: [this.checkRuleNaming, this.checkRuleHasExpression],
      Import: [this.checkImportNotEmpty],
      RosettaExpression: [this.checkExpressionValid]
    };
    registry.register(checks, this);
  }

  // ── Structural Validations (S-01 to S-27) ───────────────────────────

  /**
   * S-01: No duplicate attribute names within a Data type.
   */
  checkDataNoDuplicateAttributes(node: Data, accept: ValidationAcceptor): void {
    const seen = new Set<string>();
    for (const attr of node.attributes) {
      if (seen.has(attr.name)) {
        accept('error', `Duplicate attribute '${attr.name}'.`, {
          node: attr,
          property: 'name'
        });
      }
      seen.add(attr.name);
    }
  }

  /**
   * S-02: Detect circular inheritance in Data extends chain.
   */
  checkDataExtendsCycle(node: Data, accept: ValidationAcceptor): void {
    const visited = new Set<Data>();
    let current: Data | undefined = node;
    while (current) {
      if (visited.has(current)) {
        accept('error', `Circular inheritance detected for '${node.name}'.`, {
          node,
          property: 'superType'
        });
        return;
      }
      visited.add(current);
      current = current.superType?.ref as Data | undefined;
    }
  }

  /**
   * S-04: Attribute cardinality must have lower <= upper.
   */
  checkAttributeCardinality(node: Attribute, accept: ValidationAcceptor): void {
    const card = node.card;
    if (!card) return;
    const inf = card.inf;
    const sup = card.sup;
    if (sup !== undefined && inf !== undefined && !card.unbounded) {
      if (inf > sup) {
        accept('error', `Lower bound (${inf}) must not exceed upper bound (${sup}).`, {
          node: card,
          property: 'inf'
        });
      }
    }
  }

  /**
   * S-06: No duplicate function input names.
   */
  checkFunctionNoDuplicateInputs(node: RosettaFunction, accept: ValidationAcceptor): void {
    const seen = new Set<string>();
    for (const input of node.inputs) {
      if (seen.has(input.name)) {
        accept('error', `Duplicate input '${input.name}'.`, {
          node: input,
          property: 'name'
        });
      }
      seen.add(input.name);
    }
  }

  /**
   * S-07: Functions should have an output.
   * Dispatch functions (with dispatchAttribute) are exempt — they inherit output from the parent.
   */
  checkFunctionOutputRequired(node: RosettaFunction, accept: ValidationAcceptor): void {
    if (!node.output && !node.dispatchAttribute) {
      accept('warning', `Function '${node.name}' has no output.`, {
        node,
        property: 'name'
      });
    }
  }

  /**
   * S-09: No duplicate enum value names.
   */
  checkEnumNoDuplicateValues(node: RosettaEnumeration, accept: ValidationAcceptor): void {
    const seen = new Set<string>();
    for (const value of node.enumValues) {
      if (seen.has(value.name)) {
        accept('error', `Duplicate enum value '${value.name}'.`, {
          node: value,
          property: 'name'
        });
      }
      seen.add(value.name);
    }
  }

  /**
   * S-11: No duplicate choice option type references.
   */
  checkChoiceNoDuplicateOptions(node: Choice, accept: ValidationAcceptor): void {
    const seen = new Set<string>();
    for (const opt of node.attributes) {
      const typeName = opt.typeCall?.type?.$refText;
      if (typeName && seen.has(typeName)) {
        accept('error', `Duplicate choice option '${typeName}'.`, {
          node: opt,
          property: 'typeCall'
        });
      }
      if (typeName) seen.add(typeName);
    }
  }

  /**
   * S-13: No duplicate top-level element names in the same model.
   * Dispatch function overloads share the same name intentionally — skip them.
   */
  checkModelNoDuplicateElements(node: RosettaModel, accept: ValidationAcceptor): void {
    const seen = new Set<string>();
    for (const element of node.elements) {
      const name = (element as { name?: string }).name;
      if (!name) continue;
      // Dispatch function overloads have a dispatchAttribute; they legitimately share names
      if (isRosettaFunction(element) && element.dispatchAttribute) continue;
      if (seen.has(name)) {
        accept('error', `Duplicate element '${name}'.`, {
          node: element,
          property: 'name' as any
        });
      }
      seen.add(name);
    }
  }

  /**
   * S-15: Override attribute must exist in the parent type.
   */
  checkDataAttributeOverrideValid(node: Data, accept: ValidationAcceptor): void {
    if (!node.superType?.ref) return;
    const superAttrs = this.collectInheritedAttributeNames(node.superType.ref as Data);
    for (const attr of node.attributes) {
      if (attr.override && !superAttrs.has(attr.name)) {
        accept('error', `Attribute '${attr.name}' is marked override but does not exist in supertype.`, {
          node: attr,
          property: 'name'
        });
      }
    }
  }

  /**
   * S-16: Data type should have at least one attribute or extend another type.
   */
  checkDataMustHaveAttributesOrSuperType(_node: Data, _accept: ValidationAcceptor): void {
    // Xtext does not flag empty data types — marker types like `Empty`, `Reference`,
    // `MasterAgreementBase` etc. are valid in CDM/FpML.
  }

  /**
   * S-17: Attribute type reference must resolve.
   *
   * NOTE: Not registered. Langium's built-in linker already emits an error for
   * unresolved TypeCall.type references, so registering this check would produce
   * duplicate error messages.
   */
  checkAttributeTypeResolved(node: Attribute, accept: ValidationAcceptor): void {
    if (node.typeCall && node.typeCall.type && !node.typeCall.type.ref) {
      accept('error', `Unresolved type reference '${node.typeCall.type.$refText}'.`, {
        node: node.typeCall,
        property: 'type'
      });
    }
  }

  /**
   * S-18: No duplicate shortcut names in a function.
   */
  checkFunctionNoDuplicateShortcuts(node: RosettaFunction, accept: ValidationAcceptor): void {
    const seen = new Set<string>();
    for (const shortcut of node.shortcuts) {
      if (seen.has(shortcut.name)) {
        accept('error', `Duplicate shortcut '${shortcut.name}'.`, {
          node: shortcut,
          property: 'name'
        });
      }
      seen.add(shortcut.name);
    }
  }

  /**
   * S-19: No duplicate condition names in a function.
   */
  checkFunctionNoDuplicateConditions(node: RosettaFunction, accept: ValidationAcceptor): void {
    const seen = new Set<string>();
    for (const cond of node.conditions) {
      if (cond.name && seen.has(cond.name)) {
        accept('error', `Duplicate condition '${cond.name}'.`, {
          node: cond,
          property: 'name'
        });
      }
      if (cond.name) seen.add(cond.name);
    }
  }

  /**
   * S-20: Detect circular inheritance in Enum extends chain.
   */
  checkEnumExtendsCycle(node: RosettaEnumeration, accept: ValidationAcceptor): void {
    const visited = new Set<RosettaEnumeration>();
    let current: RosettaEnumeration | undefined = node;
    while (current) {
      if (visited.has(current)) {
        accept('error', `Circular inheritance detected for enum '${node.name}'.`, {
          node,
          property: 'name'
        });
        return;
      }
      visited.add(current);
      current = (current as any).parent?.ref as RosettaEnumeration | undefined;
    }
  }

  /**
   * S-21: Choice must have at least two options.
   */
  checkChoiceMinOptions(node: Choice, accept: ValidationAcceptor): void {
    if (node.attributes.length < 2) {
      accept('warning', `Choice '${node.name}' should have at least two options.`, {
        node,
        property: 'name'
      });
    }
  }

  /**
   * S-22: ChoiceOption type must resolve.
   *
   * NOTE: Not registered. Langium's built-in linker already emits an error for
   * unresolved TypeCall.type references, so registering this check would produce
   * duplicate error messages.
   */
  checkChoiceOptionTypeResolved(node: ChoiceOption, accept: ValidationAcceptor): void {
    if (node.typeCall && node.typeCall.type && !node.typeCall.type.ref) {
      accept('error', `Unresolved type reference '${node.typeCall.type.$refText}'.`, {
        node: node.typeCall,
        property: 'type'
      });
    }
  }

  /**
   * S-23: Namespace must be a valid qualified name.
   */
  checkModelNamespaceValid(node: RosettaModel, accept: ValidationAcceptor): void {
    if (node.name && /\s/.test(node.name)) {
      accept('error', `Namespace '${node.name}' must not contain whitespace.`, {
        node,
        property: 'name'
      });
    }
  }

  /**
   * S-24: Condition must have an expression body.
   */
  checkConditionHasExpression(node: Condition, accept: ValidationAcceptor): void {
    if (!node.expression) {
      accept('warning', `Condition '${node.name ?? '(unnamed)'}' has no expression.`, {
        node,
        property: 'expression'
      });
    }
  }

  /**
   * S-25: ShortcutDeclaration must have an expression body.
   */
  checkShortcutHasExpression(node: ShortcutDeclaration, accept: ValidationAcceptor): void {
    if (!node.expression) {
      accept('error', `Shortcut '${node.name}' has no expression.`, {
        node,
        property: 'name'
      });
    }
  }

  /**
   * S-26: Operation must have an expression body.
   */
  checkOperationHasExpression(node: Operation, accept: ValidationAcceptor): void {
    if (!node.expression) {
      accept('error', 'Operation has no expression body.', {
        node,
        property: 'expression' as any
      });
    }
  }

  /**
   * S-27: Import path must not be empty.
   */
  checkImportNotEmpty(node: Import, accept: ValidationAcceptor): void {
    if (!node.importedNamespace || node.importedNamespace.trim() === '') {
      accept('error', 'Import path must not be empty.', {
        node,
        property: 'importedNamespace'
      });
    }
  }

  // ── Naming Convention Validations (N-01 to N-12) ────────────────────

  /**
   * N-01: Data type names should start with uppercase.
   */
  checkDataNaming(node: Data, accept: ValidationAcceptor): void {
    if (node.name && /^[a-z]/.test(node.name)) {
      accept('warning', `Data type '${node.name}' should start with an uppercase letter.`, {
        node,
        property: 'name'
      });
    }
  }

  /**
   * N-02: Attribute names should start with lowercase.
   * Exempt: attributes inside Annotation blocks and ChoiceOptions (matching Xtext behavior).
   */
  checkAttributeNaming(node: Attribute, accept: ValidationAcceptor): void {
    if (isChoiceOption(node)) return;
    if (isAnnotation(node.$container)) return;
    if (node.name && /^[A-Z]/.test(node.name)) {
      accept('warning', `Attribute '${node.name}' should start with a lowercase letter.`, {
        node,
        property: 'name'
      });
    }
  }

  /**
   * N-03: Function names should start with uppercase.
   */
  checkFunctionNaming(node: RosettaFunction, accept: ValidationAcceptor): void {
    if (node.name && /^[a-z]/.test(node.name)) {
      accept('warning', `Function '${node.name}' should start with an uppercase letter.`, {
        node,
        property: 'name'
      });
    }
  }

  /**
   * N-04: Enum names should start with uppercase.
   */
  checkEnumNaming(node: RosettaEnumeration, accept: ValidationAcceptor): void {
    if (node.name && /^[a-z]/.test(node.name)) {
      accept('warning', `Enum '${node.name}' should start with an uppercase letter.`, {
        node,
        property: 'name'
      });
    }
  }

  /**
   * N-05: Choice names should start with uppercase.
   */
  checkChoiceNaming(node: Choice, accept: ValidationAcceptor): void {
    if (node.name && /^[a-z]/.test(node.name)) {
      accept('warning', `Choice '${node.name}' should start with an uppercase letter.`, {
        node,
        property: 'name'
      });
    }
  }

  /**
   * N-06: Condition names should start with uppercase.
   */
  checkConditionNaming(node: Condition, accept: ValidationAcceptor): void {
    if (node.name && /^[a-z]/.test(node.name)) {
      accept('warning', `Condition '${node.name}' should start with an uppercase letter.`, {
        node,
        property: 'name'
      });
    }
  }

  /**
   * N-07: Enum value names should start with an uppercase letter (convention: PascalCase or UPPER_CASE).
   */
  checkEnumValueNaming(_node: RosettaEnumeration, _accept: ValidationAcceptor): void {
    // Xtext does not enforce enum value casing — CDM/FpML use lowercase values
    // like `iTraxxEurope`, `clearingDateTime`, etc.
  }

  /**
   * N-08: Standalone enum value naming (used from ChoiceOption context).
   */
  checkEnumValueNamingRule(_node: RosettaEnumValue, _accept: ValidationAcceptor): void {
    // Already handled by checkEnumValueNaming on the parent, but kept for completeness
  }

  /**
   * N-09: Shortcut names should start with lowercase.
   */
  checkShortcutNaming(_node: ShortcutDeclaration, _accept: ValidationAcceptor): void {
    // Xtext does not enforce shortcut casing — CDM uses uppercase shortcuts
    // like `EuropeanExercise`, `AmericanExercise`.
  }

  /**
   * N-10: Rule names should start with uppercase.
   */
  checkRuleNaming(node: RosettaRule, accept: ValidationAcceptor): void {
    if (node.name && /^[a-z]/.test(node.name)) {
      accept('warning', `Rule '${node.name}' should start with an uppercase letter.`, {
        node,
        property: 'name'
      });
    }
  }

  // ── Reporting Validations (R-01 to R-05) ────────────────────────────

  /**
   * R-01: Rule must have an expression body.
   */
  checkRuleHasExpression(node: RosettaRule, accept: ValidationAcceptor): void {
    if (!node.expression) {
      accept('error', `Rule '${node.name}' has no expression body.`, {
        node,
        property: 'name'
      });
    }
  }

  // ── Expression Validations (E-01 to E-22) ───────────────────────────

  /**
   * Expression validator dispatcher.
   * Routes to specific checks based on expression $type.
   */
  checkExpressionValid(node: RosettaExpression, accept: ValidationAcceptor): void {
    // E-01: Conditional expression must have 'if' and 'ifthen'
    if (isRosettaConditionalExpression(node)) {
      if (!node.if) {
        accept('error', 'Conditional expression missing condition.', {
          node,
          property: 'if' as any
        });
      }
      if (!node.ifthen) {
        accept('error', 'Conditional expression missing then-branch.', {
          node,
          property: 'ifthen' as any
        });
      }
    }

    // E-02: Logical operations must have both left and right operands
    if (isLogicalOperation(node)) {
      if (!node.left) {
        accept('error', `Logical '${node.operator}' missing left operand.`, {
          node,
          property: 'left' as any
        });
      }
      if (!node.right) {
        accept('error', `Logical '${node.operator}' missing right operand.`, {
          node,
          property: 'right' as any
        });
      }
    }

    // E-03: Comparison operations must have both left and right operands
    if (isComparisonOperation(node)) {
      if (!node.left) {
        accept('error', `Comparison '${node.operator}' missing left operand.`, {
          node,
          property: 'left' as any
        });
      }
      if (!node.right) {
        accept('error', `Comparison '${node.operator}' missing right operand.`, {
          node,
          property: 'right' as any
        });
      }
    }

    // E-04: Equality operations must have both left and right operands
    // Headless equality with cardMod (e.g., `then all = True`) is valid — the left
    // operand is the implicit `item` filled in by derived state.
    if (isEqualityOperation(node)) {
      if (!node.left && !node.cardMod) {
        accept('error', `Equality '${node.operator}' missing left operand.`, {
          node,
          property: 'left' as any
        });
      }
      if (!node.right) {
        accept('error', `Equality '${node.operator}' missing right operand.`, {
          node,
          property: 'right' as any
        });
      }
    }

    // E-05: Arithmetic operations must have both left and right operands
    if (isArithmeticOperation(node)) {
      if (!node.left) {
        accept('error', `Arithmetic '${node.operator}' missing left operand.`, {
          node,
          property: 'left' as any
        });
      }
      if (!node.right) {
        accept('error', `Arithmetic '${node.operator}' missing right operand.`, {
          node,
          property: 'right' as any
        });
      }
    }

    // E-06: Contains/Disjoint must have right operand
    if (isRosettaContainsExpression(node) && !node.right) {
      accept('error', "'contains' missing right operand.", { node, property: 'right' as any });
    }
    if (isRosettaDisjointExpression(node) && !node.right) {
      accept('error', "'disjoint' missing right operand.", { node, property: 'right' as any });
    }

    // E-07: Switch operation must have at least one case
    if (isSwitchOperation(node) && node.cases.length === 0) {
      accept('error', 'Switch expression must have at least one case.', {
        node,
        property: 'cases' as any
      });
    }

    // E-08: Constructor expression values should not be empty (unless implicitEmpty)
    if (isRosettaConstructorExpression(node)) {
      if (node.values.length === 0 && !node.implicitEmpty) {
        accept('warning', 'Constructor expression has no key-value pairs.', {
          node,
          property: 'values' as any
        });
      }
    }

    // E-09: only-exists requires at least one argument
    if (isRosettaOnlyExistsExpression(node)) {
      if (!node.argument && (!node.args || node.args.length === 0)) {
        accept('error', "'only exists' requires at least one expression.", {
          node,
          property: 'argument' as any
        });
      }
    }

    // E-10: Feature call receiver should not be missing
    if (isRosettaFeatureCall(node) && !node.receiver) {
      accept('error', 'Feature call missing receiver expression.', {
        node,
        property: 'receiver' as any
      });
    }

    // E-11: Deep feature call receiver should not be missing
    if (isRosettaDeepFeatureCall(node) && !node.receiver) {
      accept('error', 'Deep feature call missing receiver expression.', {
        node,
        property: 'receiver' as any
      });
    }
  }

  // ── Helper methods ──────────────────────────────────────────────────

  /**
   * Collect inherited attribute names from a Data type's supertype chain.
   */
  private collectInheritedAttributeNames(data: Data, visited?: Set<Data>): Set<string> {
    if (!visited) visited = new Set();
    if (visited.has(data)) return new Set();
    visited.add(data);

    const names = new Set<string>();
    for (const attr of data.attributes) {
      names.add(attr.name);
    }
    const superRef = data.superType?.ref as Data | undefined;
    if (superRef) {
      for (const name of this.collectInheritedAttributeNames(superRef, visited)) {
        names.add(name);
      }
    }
    return names;
  }
}
