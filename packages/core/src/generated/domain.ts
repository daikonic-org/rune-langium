import type * as ast from './ast.js';
import type { Dehydrated } from '../serializer/dehydrated.js';

export * from './ast.js';

export type Annotation = ast.Annotation;
export namespace Annotation {
  export function getAttributes(node: Dehydrated<ast.Annotation>): Dehydrated<ast.Attribute>[] {
    return node.attributes;
  }
  export function addAttribute(node: Dehydrated<ast.Annotation>, attribute: Dehydrated<ast.Attribute>): void {
    node.attributes.push(attribute);
  }
  export function insertAttributeAt(
    node: Dehydrated<ast.Annotation>,
    index: number,
    attribute: Dehydrated<ast.Attribute>
  ): void {
    node.attributes.splice(index, 0, attribute);
  }
  export function removeAttributeAt(node: Dehydrated<ast.Annotation>, index: number): void {
    node.attributes.splice(index, 1);
  }
  export function setAttributeAt(
    node: Dehydrated<ast.Annotation>,
    index: number,
    attribute: Dehydrated<ast.Attribute>
  ): void {
    node.attributes[index] = attribute;
  }
  export function moveAttributeAt(node: Dehydrated<ast.Annotation>, from: number, to: number): void {
    if (from < 0 || from >= node.attributes.length) return;
    const [item] = node.attributes.splice(from, 1);
    if (item === undefined) return;
    node.attributes.splice(to, 0, item);
  }
  export function removeAttribute(node: Dehydrated<ast.Annotation>, attribute: Dehydrated<ast.Attribute>): boolean {
    const __k = attribute.name;
    const __i = node.attributes.findIndex((e) => e.name === __k);
    if (__i < 0) return false;
    node.attributes.splice(__i, 1);
    return true;
  }
}

export type AnnotationDeepPath = ast.AnnotationDeepPath;
export namespace AnnotationDeepPath {
  export function setAttribute(node: Dehydrated<ast.AnnotationDeepPath>, refText: string): void {
    node.attribute = { $refText: refText };
  }
}

export type AnnotationPath = ast.AnnotationPath;
export namespace AnnotationPath {
  export function setAttribute(node: Dehydrated<ast.AnnotationPath>, refText: string): void {
    node.attribute = { $refText: refText };
  }
}

export type AnnotationPathAttributeReference = ast.AnnotationPathAttributeReference;
export namespace AnnotationPathAttributeReference {
  export function setAttribute(node: Dehydrated<ast.AnnotationPathAttributeReference>, refText: string): void {
    node.attribute = { $refText: refText };
  }
}

export type AnnotationQualifier = ast.AnnotationQualifier;
export namespace AnnotationQualifier {
  export function setQualPath(
    node: Dehydrated<ast.AnnotationQualifier>,
    qualPath: Dehydrated<ast.RosettaAttributeReference>
  ): void {
    node.qualPath = qualPath;
  }
  export function clearQualPath(node: Dehydrated<ast.AnnotationQualifier>): void {
    node.qualPath = undefined;
  }
}

export type AnnotationRef = ast.AnnotationRef;
export namespace AnnotationRef {
  export function setAnnotation(node: Dehydrated<ast.AnnotationRef>, refText: string): void {
    node.annotation = { $refText: refText };
  }
  export function setAttribute(node: Dehydrated<ast.AnnotationRef>, refText: string): void {
    node.attribute = { $refText: refText };
  }
  export function clearAttribute(node: Dehydrated<ast.AnnotationRef>): void {
    node.attribute = undefined;
  }
  export function getQualifiers(node: Dehydrated<ast.AnnotationRef>): Dehydrated<ast.AnnotationQualifier>[] {
    return node.qualifiers;
  }
  export function addQualifier(
    node: Dehydrated<ast.AnnotationRef>,
    qualifier: Dehydrated<ast.AnnotationQualifier>
  ): void {
    node.qualifiers.push(qualifier);
  }
  export function insertQualifierAt(
    node: Dehydrated<ast.AnnotationRef>,
    index: number,
    qualifier: Dehydrated<ast.AnnotationQualifier>
  ): void {
    node.qualifiers.splice(index, 0, qualifier);
  }
  export function removeQualifierAt(node: Dehydrated<ast.AnnotationRef>, index: number): void {
    node.qualifiers.splice(index, 1);
  }
  export function setQualifierAt(
    node: Dehydrated<ast.AnnotationRef>,
    index: number,
    qualifier: Dehydrated<ast.AnnotationQualifier>
  ): void {
    node.qualifiers[index] = qualifier;
  }
  export function moveQualifierAt(node: Dehydrated<ast.AnnotationRef>, from: number, to: number): void {
    if (from < 0 || from >= node.qualifiers.length) return;
    const [item] = node.qualifiers.splice(from, 1);
    if (item === undefined) return;
    node.qualifiers.splice(to, 0, item);
  }
}

export type AsOperation = ast.AsOperation;
export namespace AsOperation {
  export function setType(node: Dehydrated<ast.AsOperation>, refText: string): void {
    node.type = { $refText: refText };
  }
}

export type Attribute = ast.Attribute;
export namespace Attribute {
  export function setTypeCall(node: Dehydrated<ast.Attribute>, typeCall: Dehydrated<ast.TypeCall>): void {
    node.typeCall = typeCall;
  }
  export function getTypeCallArgs(node: Dehydrated<ast.Attribute>): Dehydrated<ast.TypeCallArgument>[] {
    return node.typeCallArgs;
  }
  export function addTypeCallArg(node: Dehydrated<ast.Attribute>, typeCallArg: Dehydrated<ast.TypeCallArgument>): void {
    node.typeCallArgs.push(typeCallArg);
  }
  export function insertTypeCallArgAt(
    node: Dehydrated<ast.Attribute>,
    index: number,
    typeCallArg: Dehydrated<ast.TypeCallArgument>
  ): void {
    node.typeCallArgs.splice(index, 0, typeCallArg);
  }
  export function removeTypeCallArgAt(node: Dehydrated<ast.Attribute>, index: number): void {
    node.typeCallArgs.splice(index, 1);
  }
  export function setTypeCallArgAt(
    node: Dehydrated<ast.Attribute>,
    index: number,
    typeCallArg: Dehydrated<ast.TypeCallArgument>
  ): void {
    node.typeCallArgs[index] = typeCallArg;
  }
  export function moveTypeCallArgAt(node: Dehydrated<ast.Attribute>, from: number, to: number): void {
    if (from < 0 || from >= node.typeCallArgs.length) return;
    const [item] = node.typeCallArgs.splice(from, 1);
    if (item === undefined) return;
    node.typeCallArgs.splice(to, 0, item);
  }
  export function setCard(node: Dehydrated<ast.Attribute>, card: Dehydrated<ast.RosettaCardinality>): void {
    node.card = card;
  }
  export function getReferences(node: Dehydrated<ast.Attribute>): Dehydrated<ast.RosettaDocReference>[] {
    return node.references;
  }
  export function addReference(node: Dehydrated<ast.Attribute>, reference: Dehydrated<ast.RosettaDocReference>): void {
    node.references.push(reference);
  }
  export function insertReferenceAt(
    node: Dehydrated<ast.Attribute>,
    index: number,
    reference: Dehydrated<ast.RosettaDocReference>
  ): void {
    node.references.splice(index, 0, reference);
  }
  export function removeReferenceAt(node: Dehydrated<ast.Attribute>, index: number): void {
    node.references.splice(index, 1);
  }
  export function setReferenceAt(
    node: Dehydrated<ast.Attribute>,
    index: number,
    reference: Dehydrated<ast.RosettaDocReference>
  ): void {
    node.references[index] = reference;
  }
  export function moveReferenceAt(node: Dehydrated<ast.Attribute>, from: number, to: number): void {
    if (from < 0 || from >= node.references.length) return;
    const [item] = node.references.splice(from, 1);
    if (item === undefined) return;
    node.references.splice(to, 0, item);
  }
  export function getAnnotations(node: Dehydrated<ast.Attribute>): Dehydrated<ast.AnnotationRef>[] {
    return node.annotations;
  }
  export function addAnnotation(node: Dehydrated<ast.Attribute>, annotation: Dehydrated<ast.AnnotationRef>): void {
    node.annotations.push(annotation);
  }
  export function insertAnnotationAt(
    node: Dehydrated<ast.Attribute>,
    index: number,
    annotation: Dehydrated<ast.AnnotationRef>
  ): void {
    node.annotations.splice(index, 0, annotation);
  }
  export function removeAnnotationAt(node: Dehydrated<ast.Attribute>, index: number): void {
    node.annotations.splice(index, 1);
  }
  export function setAnnotationAt(
    node: Dehydrated<ast.Attribute>,
    index: number,
    annotation: Dehydrated<ast.AnnotationRef>
  ): void {
    node.annotations[index] = annotation;
  }
  export function moveAnnotationAt(node: Dehydrated<ast.Attribute>, from: number, to: number): void {
    if (from < 0 || from >= node.annotations.length) return;
    const [item] = node.annotations.splice(from, 1);
    if (item === undefined) return;
    node.annotations.splice(to, 0, item);
  }
  export function getSynonyms(node: Dehydrated<ast.Attribute>): Dehydrated<ast.RosettaSynonym>[] {
    return node.synonyms;
  }
  export function addSynonym(node: Dehydrated<ast.Attribute>, synonym: Dehydrated<ast.RosettaSynonym>): void {
    node.synonyms.push(synonym);
  }
  export function insertSynonymAt(
    node: Dehydrated<ast.Attribute>,
    index: number,
    synonym: Dehydrated<ast.RosettaSynonym>
  ): void {
    node.synonyms.splice(index, 0, synonym);
  }
  export function removeSynonymAt(node: Dehydrated<ast.Attribute>, index: number): void {
    node.synonyms.splice(index, 1);
  }
  export function setSynonymAt(
    node: Dehydrated<ast.Attribute>,
    index: number,
    synonym: Dehydrated<ast.RosettaSynonym>
  ): void {
    node.synonyms[index] = synonym;
  }
  export function moveSynonymAt(node: Dehydrated<ast.Attribute>, from: number, to: number): void {
    if (from < 0 || from >= node.synonyms.length) return;
    const [item] = node.synonyms.splice(from, 1);
    if (item === undefined) return;
    node.synonyms.splice(to, 0, item);
  }
  export function getLabels(node: Dehydrated<ast.Attribute>): Dehydrated<ast.LabelAnnotation>[] {
    return node.labels;
  }
  export function addLabel(node: Dehydrated<ast.Attribute>, label: Dehydrated<ast.LabelAnnotation>): void {
    node.labels.push(label);
  }
  export function insertLabelAt(
    node: Dehydrated<ast.Attribute>,
    index: number,
    label: Dehydrated<ast.LabelAnnotation>
  ): void {
    node.labels.splice(index, 0, label);
  }
  export function removeLabelAt(node: Dehydrated<ast.Attribute>, index: number): void {
    node.labels.splice(index, 1);
  }
  export function setLabelAt(
    node: Dehydrated<ast.Attribute>,
    index: number,
    label: Dehydrated<ast.LabelAnnotation>
  ): void {
    node.labels[index] = label;
  }
  export function moveLabelAt(node: Dehydrated<ast.Attribute>, from: number, to: number): void {
    if (from < 0 || from >= node.labels.length) return;
    const [item] = node.labels.splice(from, 1);
    if (item === undefined) return;
    node.labels.splice(to, 0, item);
  }
  export function getRuleReferences(node: Dehydrated<ast.Attribute>): Dehydrated<ast.RuleReferenceAnnotation>[] {
    return node.ruleReferences;
  }
  export function addRuleReference(
    node: Dehydrated<ast.Attribute>,
    ruleReference: Dehydrated<ast.RuleReferenceAnnotation>
  ): void {
    node.ruleReferences.push(ruleReference);
  }
  export function insertRuleReferenceAt(
    node: Dehydrated<ast.Attribute>,
    index: number,
    ruleReference: Dehydrated<ast.RuleReferenceAnnotation>
  ): void {
    node.ruleReferences.splice(index, 0, ruleReference);
  }
  export function removeRuleReferenceAt(node: Dehydrated<ast.Attribute>, index: number): void {
    node.ruleReferences.splice(index, 1);
  }
  export function setRuleReferenceAt(
    node: Dehydrated<ast.Attribute>,
    index: number,
    ruleReference: Dehydrated<ast.RuleReferenceAnnotation>
  ): void {
    node.ruleReferences[index] = ruleReference;
  }
  export function moveRuleReferenceAt(node: Dehydrated<ast.Attribute>, from: number, to: number): void {
    if (from < 0 || from >= node.ruleReferences.length) return;
    const [item] = node.ruleReferences.splice(from, 1);
    if (item === undefined) return;
    node.ruleReferences.splice(to, 0, item);
  }
}

export type Choice = ast.Choice;
export namespace Choice {
  export function getAttributes(node: Dehydrated<ast.Choice>): Dehydrated<ast.ChoiceOption>[] {
    return node.attributes;
  }
  export function addAttribute(node: Dehydrated<ast.Choice>, attribute: Dehydrated<ast.ChoiceOption>): void {
    node.attributes.push(attribute);
  }
  export function insertAttributeAt(
    node: Dehydrated<ast.Choice>,
    index: number,
    attribute: Dehydrated<ast.ChoiceOption>
  ): void {
    node.attributes.splice(index, 0, attribute);
  }
  export function removeAttributeAt(node: Dehydrated<ast.Choice>, index: number): void {
    node.attributes.splice(index, 1);
  }
  export function setAttributeAt(
    node: Dehydrated<ast.Choice>,
    index: number,
    attribute: Dehydrated<ast.ChoiceOption>
  ): void {
    node.attributes[index] = attribute;
  }
  export function moveAttributeAt(node: Dehydrated<ast.Choice>, from: number, to: number): void {
    if (from < 0 || from >= node.attributes.length) return;
    const [item] = node.attributes.splice(from, 1);
    if (item === undefined) return;
    node.attributes.splice(to, 0, item);
  }
  export function removeAttribute(node: Dehydrated<ast.Choice>, attribute: Dehydrated<ast.ChoiceOption>): boolean {
    const __k = attribute.typeCall?.type?.$refText;
    const __i = node.attributes.findIndex((e) => e.typeCall?.type?.$refText === __k);
    if (__i < 0) return false;
    node.attributes.splice(__i, 1);
    return true;
  }
  export function getAnnotations(node: Dehydrated<ast.Choice>): Dehydrated<ast.AnnotationRef>[] {
    return node.annotations;
  }
  export function addAnnotation(node: Dehydrated<ast.Choice>, annotation: Dehydrated<ast.AnnotationRef>): void {
    node.annotations.push(annotation);
  }
  export function insertAnnotationAt(
    node: Dehydrated<ast.Choice>,
    index: number,
    annotation: Dehydrated<ast.AnnotationRef>
  ): void {
    node.annotations.splice(index, 0, annotation);
  }
  export function removeAnnotationAt(node: Dehydrated<ast.Choice>, index: number): void {
    node.annotations.splice(index, 1);
  }
  export function setAnnotationAt(
    node: Dehydrated<ast.Choice>,
    index: number,
    annotation: Dehydrated<ast.AnnotationRef>
  ): void {
    node.annotations[index] = annotation;
  }
  export function moveAnnotationAt(node: Dehydrated<ast.Choice>, from: number, to: number): void {
    if (from < 0 || from >= node.annotations.length) return;
    const [item] = node.annotations.splice(from, 1);
    if (item === undefined) return;
    node.annotations.splice(to, 0, item);
  }
  export function getSynonyms(node: Dehydrated<ast.Choice>): Dehydrated<ast.RosettaClassSynonym>[] {
    return node.synonyms;
  }
  export function addSynonym(node: Dehydrated<ast.Choice>, synonym: Dehydrated<ast.RosettaClassSynonym>): void {
    node.synonyms.push(synonym);
  }
  export function insertSynonymAt(
    node: Dehydrated<ast.Choice>,
    index: number,
    synonym: Dehydrated<ast.RosettaClassSynonym>
  ): void {
    node.synonyms.splice(index, 0, synonym);
  }
  export function removeSynonymAt(node: Dehydrated<ast.Choice>, index: number): void {
    node.synonyms.splice(index, 1);
  }
  export function setSynonymAt(
    node: Dehydrated<ast.Choice>,
    index: number,
    synonym: Dehydrated<ast.RosettaClassSynonym>
  ): void {
    node.synonyms[index] = synonym;
  }
  export function moveSynonymAt(node: Dehydrated<ast.Choice>, from: number, to: number): void {
    if (from < 0 || from >= node.synonyms.length) return;
    const [item] = node.synonyms.splice(from, 1);
    if (item === undefined) return;
    node.synonyms.splice(to, 0, item);
  }
}

export type ChoiceOption = ast.ChoiceOption;
export namespace ChoiceOption {
  export function setTypeCall(node: Dehydrated<ast.ChoiceOption>, typeCall: Dehydrated<ast.TypeCall>): void {
    node.typeCall = typeCall;
  }
  export function getReferences(node: Dehydrated<ast.ChoiceOption>): Dehydrated<ast.RosettaDocReference>[] {
    return node.references;
  }
  export function addReference(
    node: Dehydrated<ast.ChoiceOption>,
    reference: Dehydrated<ast.RosettaDocReference>
  ): void {
    node.references.push(reference);
  }
  export function insertReferenceAt(
    node: Dehydrated<ast.ChoiceOption>,
    index: number,
    reference: Dehydrated<ast.RosettaDocReference>
  ): void {
    node.references.splice(index, 0, reference);
  }
  export function removeReferenceAt(node: Dehydrated<ast.ChoiceOption>, index: number): void {
    node.references.splice(index, 1);
  }
  export function setReferenceAt(
    node: Dehydrated<ast.ChoiceOption>,
    index: number,
    reference: Dehydrated<ast.RosettaDocReference>
  ): void {
    node.references[index] = reference;
  }
  export function moveReferenceAt(node: Dehydrated<ast.ChoiceOption>, from: number, to: number): void {
    if (from < 0 || from >= node.references.length) return;
    const [item] = node.references.splice(from, 1);
    if (item === undefined) return;
    node.references.splice(to, 0, item);
  }
  export function getAnnotations(node: Dehydrated<ast.ChoiceOption>): Dehydrated<ast.AnnotationRef>[] {
    return node.annotations;
  }
  export function addAnnotation(node: Dehydrated<ast.ChoiceOption>, annotation: Dehydrated<ast.AnnotationRef>): void {
    node.annotations.push(annotation);
  }
  export function insertAnnotationAt(
    node: Dehydrated<ast.ChoiceOption>,
    index: number,
    annotation: Dehydrated<ast.AnnotationRef>
  ): void {
    node.annotations.splice(index, 0, annotation);
  }
  export function removeAnnotationAt(node: Dehydrated<ast.ChoiceOption>, index: number): void {
    node.annotations.splice(index, 1);
  }
  export function setAnnotationAt(
    node: Dehydrated<ast.ChoiceOption>,
    index: number,
    annotation: Dehydrated<ast.AnnotationRef>
  ): void {
    node.annotations[index] = annotation;
  }
  export function moveAnnotationAt(node: Dehydrated<ast.ChoiceOption>, from: number, to: number): void {
    if (from < 0 || from >= node.annotations.length) return;
    const [item] = node.annotations.splice(from, 1);
    if (item === undefined) return;
    node.annotations.splice(to, 0, item);
  }
  export function getSynonyms(node: Dehydrated<ast.ChoiceOption>): Dehydrated<ast.RosettaSynonym>[] {
    return node.synonyms;
  }
  export function addSynonym(node: Dehydrated<ast.ChoiceOption>, synonym: Dehydrated<ast.RosettaSynonym>): void {
    node.synonyms.push(synonym);
  }
  export function insertSynonymAt(
    node: Dehydrated<ast.ChoiceOption>,
    index: number,
    synonym: Dehydrated<ast.RosettaSynonym>
  ): void {
    node.synonyms.splice(index, 0, synonym);
  }
  export function removeSynonymAt(node: Dehydrated<ast.ChoiceOption>, index: number): void {
    node.synonyms.splice(index, 1);
  }
  export function setSynonymAt(
    node: Dehydrated<ast.ChoiceOption>,
    index: number,
    synonym: Dehydrated<ast.RosettaSynonym>
  ): void {
    node.synonyms[index] = synonym;
  }
  export function moveSynonymAt(node: Dehydrated<ast.ChoiceOption>, from: number, to: number): void {
    if (from < 0 || from >= node.synonyms.length) return;
    const [item] = node.synonyms.splice(from, 1);
    if (item === undefined) return;
    node.synonyms.splice(to, 0, item);
  }
  export function getLabels(node: Dehydrated<ast.ChoiceOption>): Dehydrated<ast.LabelAnnotation>[] {
    return node.labels;
  }
  export function addLabel(node: Dehydrated<ast.ChoiceOption>, label: Dehydrated<ast.LabelAnnotation>): void {
    node.labels.push(label);
  }
  export function insertLabelAt(
    node: Dehydrated<ast.ChoiceOption>,
    index: number,
    label: Dehydrated<ast.LabelAnnotation>
  ): void {
    node.labels.splice(index, 0, label);
  }
  export function removeLabelAt(node: Dehydrated<ast.ChoiceOption>, index: number): void {
    node.labels.splice(index, 1);
  }
  export function setLabelAt(
    node: Dehydrated<ast.ChoiceOption>,
    index: number,
    label: Dehydrated<ast.LabelAnnotation>
  ): void {
    node.labels[index] = label;
  }
  export function moveLabelAt(node: Dehydrated<ast.ChoiceOption>, from: number, to: number): void {
    if (from < 0 || from >= node.labels.length) return;
    const [item] = node.labels.splice(from, 1);
    if (item === undefined) return;
    node.labels.splice(to, 0, item);
  }
  export function getRuleReferences(node: Dehydrated<ast.ChoiceOption>): Dehydrated<ast.RuleReferenceAnnotation>[] {
    return node.ruleReferences;
  }
  export function addRuleReference(
    node: Dehydrated<ast.ChoiceOption>,
    ruleReference: Dehydrated<ast.RuleReferenceAnnotation>
  ): void {
    node.ruleReferences.push(ruleReference);
  }
  export function insertRuleReferenceAt(
    node: Dehydrated<ast.ChoiceOption>,
    index: number,
    ruleReference: Dehydrated<ast.RuleReferenceAnnotation>
  ): void {
    node.ruleReferences.splice(index, 0, ruleReference);
  }
  export function removeRuleReferenceAt(node: Dehydrated<ast.ChoiceOption>, index: number): void {
    node.ruleReferences.splice(index, 1);
  }
  export function setRuleReferenceAt(
    node: Dehydrated<ast.ChoiceOption>,
    index: number,
    ruleReference: Dehydrated<ast.RuleReferenceAnnotation>
  ): void {
    node.ruleReferences[index] = ruleReference;
  }
  export function moveRuleReferenceAt(node: Dehydrated<ast.ChoiceOption>, from: number, to: number): void {
    if (from < 0 || from >= node.ruleReferences.length) return;
    const [item] = node.ruleReferences.splice(from, 1);
    if (item === undefined) return;
    node.ruleReferences.splice(to, 0, item);
  }
}

export type Condition = ast.Condition;
export namespace Condition {
  export function getReferences(node: Dehydrated<ast.Condition>): Dehydrated<ast.RosettaDocReference>[] {
    return node.references;
  }
  export function addReference(node: Dehydrated<ast.Condition>, reference: Dehydrated<ast.RosettaDocReference>): void {
    node.references.push(reference);
  }
  export function insertReferenceAt(
    node: Dehydrated<ast.Condition>,
    index: number,
    reference: Dehydrated<ast.RosettaDocReference>
  ): void {
    node.references.splice(index, 0, reference);
  }
  export function removeReferenceAt(node: Dehydrated<ast.Condition>, index: number): void {
    node.references.splice(index, 1);
  }
  export function setReferenceAt(
    node: Dehydrated<ast.Condition>,
    index: number,
    reference: Dehydrated<ast.RosettaDocReference>
  ): void {
    node.references[index] = reference;
  }
  export function moveReferenceAt(node: Dehydrated<ast.Condition>, from: number, to: number): void {
    if (from < 0 || from >= node.references.length) return;
    const [item] = node.references.splice(from, 1);
    if (item === undefined) return;
    node.references.splice(to, 0, item);
  }
  export function getAnnotations(node: Dehydrated<ast.Condition>): Dehydrated<ast.AnnotationRef>[] {
    return node.annotations;
  }
  export function addAnnotation(node: Dehydrated<ast.Condition>, annotation: Dehydrated<ast.AnnotationRef>): void {
    node.annotations.push(annotation);
  }
  export function insertAnnotationAt(
    node: Dehydrated<ast.Condition>,
    index: number,
    annotation: Dehydrated<ast.AnnotationRef>
  ): void {
    node.annotations.splice(index, 0, annotation);
  }
  export function removeAnnotationAt(node: Dehydrated<ast.Condition>, index: number): void {
    node.annotations.splice(index, 1);
  }
  export function setAnnotationAt(
    node: Dehydrated<ast.Condition>,
    index: number,
    annotation: Dehydrated<ast.AnnotationRef>
  ): void {
    node.annotations[index] = annotation;
  }
  export function moveAnnotationAt(node: Dehydrated<ast.Condition>, from: number, to: number): void {
    if (from < 0 || from >= node.annotations.length) return;
    const [item] = node.annotations.splice(from, 1);
    if (item === undefined) return;
    node.annotations.splice(to, 0, item);
  }
}

export type ConstructorKeyValuePair = ast.ConstructorKeyValuePair;
export namespace ConstructorKeyValuePair {
  export function setKey(node: Dehydrated<ast.ConstructorKeyValuePair>, refText: string): void {
    node.key = { $refText: refText };
  }
}

export type Data = ast.Data;
export namespace Data {
  export function setSuperType(node: Dehydrated<ast.Data>, refText: string): void {
    node.superType = { $refText: refText };
  }
  export function clearSuperType(node: Dehydrated<ast.Data>): void {
    node.superType = undefined;
  }
  export function getAttributes(node: Dehydrated<ast.Data>): Dehydrated<ast.Attribute>[] {
    return node.attributes;
  }
  export function addAttribute(node: Dehydrated<ast.Data>, attribute: Dehydrated<ast.Attribute>): void {
    node.attributes.push(attribute);
  }
  export function insertAttributeAt(
    node: Dehydrated<ast.Data>,
    index: number,
    attribute: Dehydrated<ast.Attribute>
  ): void {
    node.attributes.splice(index, 0, attribute);
  }
  export function removeAttributeAt(node: Dehydrated<ast.Data>, index: number): void {
    node.attributes.splice(index, 1);
  }
  export function setAttributeAt(
    node: Dehydrated<ast.Data>,
    index: number,
    attribute: Dehydrated<ast.Attribute>
  ): void {
    node.attributes[index] = attribute;
  }
  export function moveAttributeAt(node: Dehydrated<ast.Data>, from: number, to: number): void {
    if (from < 0 || from >= node.attributes.length) return;
    const [item] = node.attributes.splice(from, 1);
    if (item === undefined) return;
    node.attributes.splice(to, 0, item);
  }
  export function removeAttribute(node: Dehydrated<ast.Data>, attribute: Dehydrated<ast.Attribute>): boolean {
    const __k = attribute.name;
    const __i = node.attributes.findIndex((e) => e.name === __k);
    if (__i < 0) return false;
    node.attributes.splice(__i, 1);
    return true;
  }
  export function getConditions(node: Dehydrated<ast.Data>): Dehydrated<ast.Condition>[] {
    return node.conditions;
  }
  export function addCondition(node: Dehydrated<ast.Data>, condition: Dehydrated<ast.Condition>): void {
    node.conditions.push(condition);
  }
  export function insertConditionAt(
    node: Dehydrated<ast.Data>,
    index: number,
    condition: Dehydrated<ast.Condition>
  ): void {
    node.conditions.splice(index, 0, condition);
  }
  export function removeConditionAt(node: Dehydrated<ast.Data>, index: number): void {
    node.conditions.splice(index, 1);
  }
  export function setConditionAt(
    node: Dehydrated<ast.Data>,
    index: number,
    condition: Dehydrated<ast.Condition>
  ): void {
    node.conditions[index] = condition;
  }
  export function moveConditionAt(node: Dehydrated<ast.Data>, from: number, to: number): void {
    if (from < 0 || from >= node.conditions.length) return;
    const [item] = node.conditions.splice(from, 1);
    if (item === undefined) return;
    node.conditions.splice(to, 0, item);
  }
  export function getReferences(node: Dehydrated<ast.Data>): Dehydrated<ast.RosettaDocReference>[] {
    return node.references;
  }
  export function addReference(node: Dehydrated<ast.Data>, reference: Dehydrated<ast.RosettaDocReference>): void {
    node.references.push(reference);
  }
  export function insertReferenceAt(
    node: Dehydrated<ast.Data>,
    index: number,
    reference: Dehydrated<ast.RosettaDocReference>
  ): void {
    node.references.splice(index, 0, reference);
  }
  export function removeReferenceAt(node: Dehydrated<ast.Data>, index: number): void {
    node.references.splice(index, 1);
  }
  export function setReferenceAt(
    node: Dehydrated<ast.Data>,
    index: number,
    reference: Dehydrated<ast.RosettaDocReference>
  ): void {
    node.references[index] = reference;
  }
  export function moveReferenceAt(node: Dehydrated<ast.Data>, from: number, to: number): void {
    if (from < 0 || from >= node.references.length) return;
    const [item] = node.references.splice(from, 1);
    if (item === undefined) return;
    node.references.splice(to, 0, item);
  }
  export function getAnnotations(node: Dehydrated<ast.Data>): Dehydrated<ast.AnnotationRef>[] {
    return node.annotations;
  }
  export function addAnnotation(node: Dehydrated<ast.Data>, annotation: Dehydrated<ast.AnnotationRef>): void {
    node.annotations.push(annotation);
  }
  export function insertAnnotationAt(
    node: Dehydrated<ast.Data>,
    index: number,
    annotation: Dehydrated<ast.AnnotationRef>
  ): void {
    node.annotations.splice(index, 0, annotation);
  }
  export function removeAnnotationAt(node: Dehydrated<ast.Data>, index: number): void {
    node.annotations.splice(index, 1);
  }
  export function setAnnotationAt(
    node: Dehydrated<ast.Data>,
    index: number,
    annotation: Dehydrated<ast.AnnotationRef>
  ): void {
    node.annotations[index] = annotation;
  }
  export function moveAnnotationAt(node: Dehydrated<ast.Data>, from: number, to: number): void {
    if (from < 0 || from >= node.annotations.length) return;
    const [item] = node.annotations.splice(from, 1);
    if (item === undefined) return;
    node.annotations.splice(to, 0, item);
  }
  export function getSynonyms(node: Dehydrated<ast.Data>): Dehydrated<ast.RosettaClassSynonym>[] {
    return node.synonyms;
  }
  export function addSynonym(node: Dehydrated<ast.Data>, synonym: Dehydrated<ast.RosettaClassSynonym>): void {
    node.synonyms.push(synonym);
  }
  export function insertSynonymAt(
    node: Dehydrated<ast.Data>,
    index: number,
    synonym: Dehydrated<ast.RosettaClassSynonym>
  ): void {
    node.synonyms.splice(index, 0, synonym);
  }
  export function removeSynonymAt(node: Dehydrated<ast.Data>, index: number): void {
    node.synonyms.splice(index, 1);
  }
  export function setSynonymAt(
    node: Dehydrated<ast.Data>,
    index: number,
    synonym: Dehydrated<ast.RosettaClassSynonym>
  ): void {
    node.synonyms[index] = synonym;
  }
  export function moveSynonymAt(node: Dehydrated<ast.Data>, from: number, to: number): void {
    if (from < 0 || from >= node.synonyms.length) return;
    const [item] = node.synonyms.splice(from, 1);
    if (item === undefined) return;
    node.synonyms.splice(to, 0, item);
  }
}

export type FilterOperation = ast.FilterOperation;
export namespace FilterOperation {
  export function setFunction(node: Dehydrated<ast.FilterOperation>, function_: Dehydrated<ast.InlineFunction>): void {
    node.function = function_;
  }
  export function clearFunction(node: Dehydrated<ast.FilterOperation>): void {
    node.function = undefined;
  }
}

export type InlineFunction = ast.InlineFunction;
export namespace InlineFunction {
  export function getParameters(node: Dehydrated<ast.InlineFunction>): Dehydrated<ast.ClosureParameter>[] {
    return node.parameters;
  }
  export function addParameter(
    node: Dehydrated<ast.InlineFunction>,
    parameter: Dehydrated<ast.ClosureParameter>
  ): void {
    node.parameters.push(parameter);
  }
  export function insertParameterAt(
    node: Dehydrated<ast.InlineFunction>,
    index: number,
    parameter: Dehydrated<ast.ClosureParameter>
  ): void {
    node.parameters.splice(index, 0, parameter);
  }
  export function removeParameterAt(node: Dehydrated<ast.InlineFunction>, index: number): void {
    node.parameters.splice(index, 1);
  }
  export function setParameterAt(
    node: Dehydrated<ast.InlineFunction>,
    index: number,
    parameter: Dehydrated<ast.ClosureParameter>
  ): void {
    node.parameters[index] = parameter;
  }
  export function moveParameterAt(node: Dehydrated<ast.InlineFunction>, from: number, to: number): void {
    if (from < 0 || from >= node.parameters.length) return;
    const [item] = node.parameters.splice(from, 1);
    if (item === undefined) return;
    node.parameters.splice(to, 0, item);
  }
}

export type MapOperation = ast.MapOperation;
export namespace MapOperation {
  export function setFunction(node: Dehydrated<ast.MapOperation>, function_: Dehydrated<ast.InlineFunction>): void {
    node.function = function_;
  }
  export function clearFunction(node: Dehydrated<ast.MapOperation>): void {
    node.function = undefined;
  }
}

export type MaxOperation = ast.MaxOperation;
export namespace MaxOperation {
  export function setFunction(node: Dehydrated<ast.MaxOperation>, function_: Dehydrated<ast.InlineFunction>): void {
    node.function = function_;
  }
  export function clearFunction(node: Dehydrated<ast.MaxOperation>): void {
    node.function = undefined;
  }
}

export type MinOperation = ast.MinOperation;
export namespace MinOperation {
  export function setFunction(node: Dehydrated<ast.MinOperation>, function_: Dehydrated<ast.InlineFunction>): void {
    node.function = function_;
  }
  export function clearFunction(node: Dehydrated<ast.MinOperation>): void {
    node.function = undefined;
  }
}

export type Operation = ast.Operation;
export namespace Operation {
  export function setAssignRoot(node: Dehydrated<ast.Operation>, refText: string): void {
    node.assignRoot = { $refText: refText };
  }
  export function setPath(node: Dehydrated<ast.Operation>, path: Dehydrated<ast.Segment>): void {
    node.path = path;
  }
  export function clearPath(node: Dehydrated<ast.Operation>): void {
    node.path = undefined;
  }
}

export type ReduceOperation = ast.ReduceOperation;
export namespace ReduceOperation {
  export function setFunction(node: Dehydrated<ast.ReduceOperation>, function_: Dehydrated<ast.InlineFunction>): void {
    node.function = function_;
  }
  export function clearFunction(node: Dehydrated<ast.ReduceOperation>): void {
    node.function = undefined;
  }
}

export type RegulatoryDocumentReference = ast.RegulatoryDocumentReference;
export namespace RegulatoryDocumentReference {
  export function setBody(node: Dehydrated<ast.RegulatoryDocumentReference>, refText: string): void {
    node.body = { $refText: refText };
  }
  export function getSegments(node: Dehydrated<ast.RegulatoryDocumentReference>): Dehydrated<ast.RosettaSegmentRef>[] {
    return node.segments;
  }
  export function addSegment(
    node: Dehydrated<ast.RegulatoryDocumentReference>,
    segment: Dehydrated<ast.RosettaSegmentRef>
  ): void {
    node.segments.push(segment);
  }
  export function insertSegmentAt(
    node: Dehydrated<ast.RegulatoryDocumentReference>,
    index: number,
    segment: Dehydrated<ast.RosettaSegmentRef>
  ): void {
    node.segments.splice(index, 0, segment);
  }
  export function removeSegmentAt(node: Dehydrated<ast.RegulatoryDocumentReference>, index: number): void {
    node.segments.splice(index, 1);
  }
  export function setSegmentAt(
    node: Dehydrated<ast.RegulatoryDocumentReference>,
    index: number,
    segment: Dehydrated<ast.RosettaSegmentRef>
  ): void {
    node.segments[index] = segment;
  }
  export function moveSegmentAt(node: Dehydrated<ast.RegulatoryDocumentReference>, from: number, to: number): void {
    if (from < 0 || from >= node.segments.length) return;
    const [item] = node.segments.splice(from, 1);
    if (item === undefined) return;
    node.segments.splice(to, 0, item);
  }
}

export type RosettaAttributeReference = ast.RosettaAttributeReference;
export namespace RosettaAttributeReference {
  export function setAttribute(node: Dehydrated<ast.RosettaAttributeReference>, refText: string): void {
    node.attribute = { $refText: refText };
  }
}

export type RosettaBasicType = ast.RosettaBasicType;
export namespace RosettaBasicType {
  export function getParameters(node: Dehydrated<ast.RosettaBasicType>): Dehydrated<ast.TypeParameter>[] {
    return node.parameters;
  }
  export function addParameter(node: Dehydrated<ast.RosettaBasicType>, parameter: Dehydrated<ast.TypeParameter>): void {
    node.parameters.push(parameter);
  }
  export function insertParameterAt(
    node: Dehydrated<ast.RosettaBasicType>,
    index: number,
    parameter: Dehydrated<ast.TypeParameter>
  ): void {
    node.parameters.splice(index, 0, parameter);
  }
  export function removeParameterAt(node: Dehydrated<ast.RosettaBasicType>, index: number): void {
    node.parameters.splice(index, 1);
  }
  export function setParameterAt(
    node: Dehydrated<ast.RosettaBasicType>,
    index: number,
    parameter: Dehydrated<ast.TypeParameter>
  ): void {
    node.parameters[index] = parameter;
  }
  export function moveParameterAt(node: Dehydrated<ast.RosettaBasicType>, from: number, to: number): void {
    if (from < 0 || from >= node.parameters.length) return;
    const [item] = node.parameters.splice(from, 1);
    if (item === undefined) return;
    node.parameters.splice(to, 0, item);
  }
}

export type RosettaClassSynonym = ast.RosettaClassSynonym;
export namespace RosettaClassSynonym {
  export function setValue(
    node: Dehydrated<ast.RosettaClassSynonym>,
    value: Dehydrated<ast.RosettaSynonymValueBase>
  ): void {
    node.value = value;
  }
  export function clearValue(node: Dehydrated<ast.RosettaClassSynonym>): void {
    node.value = undefined;
  }
  export function setMetaValue(
    node: Dehydrated<ast.RosettaClassSynonym>,
    metaValue: Dehydrated<ast.RosettaSynonymValueBase>
  ): void {
    node.metaValue = metaValue;
  }
  export function clearMetaValue(node: Dehydrated<ast.RosettaClassSynonym>): void {
    node.metaValue = undefined;
  }
}

export type RosettaConstructorExpression = ast.RosettaConstructorExpression;
export namespace RosettaConstructorExpression {
  export function getConstructorTypeArgs(
    node: Dehydrated<ast.RosettaConstructorExpression>
  ): Dehydrated<ast.TypeCallArgument>[] {
    return node.constructorTypeArgs;
  }
  export function addConstructorTypeArg(
    node: Dehydrated<ast.RosettaConstructorExpression>,
    constructorTypeArg: Dehydrated<ast.TypeCallArgument>
  ): void {
    node.constructorTypeArgs.push(constructorTypeArg);
  }
  export function insertConstructorTypeArgAt(
    node: Dehydrated<ast.RosettaConstructorExpression>,
    index: number,
    constructorTypeArg: Dehydrated<ast.TypeCallArgument>
  ): void {
    node.constructorTypeArgs.splice(index, 0, constructorTypeArg);
  }
  export function removeConstructorTypeArgAt(node: Dehydrated<ast.RosettaConstructorExpression>, index: number): void {
    node.constructorTypeArgs.splice(index, 1);
  }
  export function setConstructorTypeArgAt(
    node: Dehydrated<ast.RosettaConstructorExpression>,
    index: number,
    constructorTypeArg: Dehydrated<ast.TypeCallArgument>
  ): void {
    node.constructorTypeArgs[index] = constructorTypeArg;
  }
  export function moveConstructorTypeArgAt(
    node: Dehydrated<ast.RosettaConstructorExpression>,
    from: number,
    to: number
  ): void {
    if (from < 0 || from >= node.constructorTypeArgs.length) return;
    const [item] = node.constructorTypeArgs.splice(from, 1);
    if (item === undefined) return;
    node.constructorTypeArgs.splice(to, 0, item);
  }
  export function getValues(
    node: Dehydrated<ast.RosettaConstructorExpression>
  ): Dehydrated<ast.ConstructorKeyValuePair>[] {
    return node.values;
  }
  export function addValue(
    node: Dehydrated<ast.RosettaConstructorExpression>,
    value: Dehydrated<ast.ConstructorKeyValuePair>
  ): void {
    node.values.push(value);
  }
  export function insertValueAt(
    node: Dehydrated<ast.RosettaConstructorExpression>,
    index: number,
    value: Dehydrated<ast.ConstructorKeyValuePair>
  ): void {
    node.values.splice(index, 0, value);
  }
  export function removeValueAt(node: Dehydrated<ast.RosettaConstructorExpression>, index: number): void {
    node.values.splice(index, 1);
  }
  export function setValueAt(
    node: Dehydrated<ast.RosettaConstructorExpression>,
    index: number,
    value: Dehydrated<ast.ConstructorKeyValuePair>
  ): void {
    node.values[index] = value;
  }
  export function moveValueAt(node: Dehydrated<ast.RosettaConstructorExpression>, from: number, to: number): void {
    if (from < 0 || from >= node.values.length) return;
    const [item] = node.values.splice(from, 1);
    if (item === undefined) return;
    node.values.splice(to, 0, item);
  }
}

export type RosettaCorpus = ast.RosettaCorpus;
export namespace RosettaCorpus {
  export function setBody(node: Dehydrated<ast.RosettaCorpus>, refText: string): void {
    node.body = { $refText: refText };
  }
  export function clearBody(node: Dehydrated<ast.RosettaCorpus>): void {
    node.body = undefined;
  }
}

export type RosettaDataReference = ast.RosettaDataReference;
export namespace RosettaDataReference {
  export function setData(node: Dehydrated<ast.RosettaDataReference>, refText: string): void {
    node.data = { $refText: refText };
  }
}

export type RosettaDeepFeatureCall = ast.RosettaDeepFeatureCall;
export namespace RosettaDeepFeatureCall {
  export function setFeature(node: Dehydrated<ast.RosettaDeepFeatureCall>, refText: string): void {
    node.feature = { $refText: refText };
  }
  export function clearFeature(node: Dehydrated<ast.RosettaDeepFeatureCall>): void {
    node.feature = undefined;
  }
}

export type RosettaDocReference = ast.RosettaDocReference;
export namespace RosettaDocReference {
  export function setDocReference(
    node: Dehydrated<ast.RosettaDocReference>,
    docReference: Dehydrated<ast.RegulatoryDocumentReference>
  ): void {
    node.docReference = docReference;
  }
  export function getRationales(node: Dehydrated<ast.RosettaDocReference>): Dehydrated<ast.DocumentRationale>[] {
    return node.rationales;
  }
  export function addRationale(
    node: Dehydrated<ast.RosettaDocReference>,
    rationale: Dehydrated<ast.DocumentRationale>
  ): void {
    node.rationales.push(rationale);
  }
  export function insertRationaleAt(
    node: Dehydrated<ast.RosettaDocReference>,
    index: number,
    rationale: Dehydrated<ast.DocumentRationale>
  ): void {
    node.rationales.splice(index, 0, rationale);
  }
  export function removeRationaleAt(node: Dehydrated<ast.RosettaDocReference>, index: number): void {
    node.rationales.splice(index, 1);
  }
  export function setRationaleAt(
    node: Dehydrated<ast.RosettaDocReference>,
    index: number,
    rationale: Dehydrated<ast.DocumentRationale>
  ): void {
    node.rationales[index] = rationale;
  }
  export function moveRationaleAt(node: Dehydrated<ast.RosettaDocReference>, from: number, to: number): void {
    if (from < 0 || from >= node.rationales.length) return;
    const [item] = node.rationales.splice(from, 1);
    if (item === undefined) return;
    node.rationales.splice(to, 0, item);
  }
}

export type RosettaEnumeration = ast.RosettaEnumeration;
export namespace RosettaEnumeration {
  export function setParent(node: Dehydrated<ast.RosettaEnumeration>, refText: string): void {
    node.parent = { $refText: refText };
  }
  export function clearParent(node: Dehydrated<ast.RosettaEnumeration>): void {
    node.parent = undefined;
  }
  export function getEnumValues(node: Dehydrated<ast.RosettaEnumeration>): Dehydrated<ast.RosettaEnumValue>[] {
    return node.enumValues;
  }
  export function addEnumValue(
    node: Dehydrated<ast.RosettaEnumeration>,
    enumValue: Dehydrated<ast.RosettaEnumValue>
  ): void {
    node.enumValues.push(enumValue);
  }
  export function insertEnumValueAt(
    node: Dehydrated<ast.RosettaEnumeration>,
    index: number,
    enumValue: Dehydrated<ast.RosettaEnumValue>
  ): void {
    node.enumValues.splice(index, 0, enumValue);
  }
  export function removeEnumValueAt(node: Dehydrated<ast.RosettaEnumeration>, index: number): void {
    node.enumValues.splice(index, 1);
  }
  export function setEnumValueAt(
    node: Dehydrated<ast.RosettaEnumeration>,
    index: number,
    enumValue: Dehydrated<ast.RosettaEnumValue>
  ): void {
    node.enumValues[index] = enumValue;
  }
  export function moveEnumValueAt(node: Dehydrated<ast.RosettaEnumeration>, from: number, to: number): void {
    if (from < 0 || from >= node.enumValues.length) return;
    const [item] = node.enumValues.splice(from, 1);
    if (item === undefined) return;
    node.enumValues.splice(to, 0, item);
  }
  export function removeEnumValue(
    node: Dehydrated<ast.RosettaEnumeration>,
    enumValue: Dehydrated<ast.RosettaEnumValue>
  ): boolean {
    const __k = enumValue.name;
    const __i = node.enumValues.findIndex((e) => e.name === __k);
    if (__i < 0) return false;
    node.enumValues.splice(__i, 1);
    return true;
  }
  export function getReferences(node: Dehydrated<ast.RosettaEnumeration>): Dehydrated<ast.RosettaDocReference>[] {
    return node.references;
  }
  export function addReference(
    node: Dehydrated<ast.RosettaEnumeration>,
    reference: Dehydrated<ast.RosettaDocReference>
  ): void {
    node.references.push(reference);
  }
  export function insertReferenceAt(
    node: Dehydrated<ast.RosettaEnumeration>,
    index: number,
    reference: Dehydrated<ast.RosettaDocReference>
  ): void {
    node.references.splice(index, 0, reference);
  }
  export function removeReferenceAt(node: Dehydrated<ast.RosettaEnumeration>, index: number): void {
    node.references.splice(index, 1);
  }
  export function setReferenceAt(
    node: Dehydrated<ast.RosettaEnumeration>,
    index: number,
    reference: Dehydrated<ast.RosettaDocReference>
  ): void {
    node.references[index] = reference;
  }
  export function moveReferenceAt(node: Dehydrated<ast.RosettaEnumeration>, from: number, to: number): void {
    if (from < 0 || from >= node.references.length) return;
    const [item] = node.references.splice(from, 1);
    if (item === undefined) return;
    node.references.splice(to, 0, item);
  }
  export function getAnnotations(node: Dehydrated<ast.RosettaEnumeration>): Dehydrated<ast.AnnotationRef>[] {
    return node.annotations;
  }
  export function addAnnotation(
    node: Dehydrated<ast.RosettaEnumeration>,
    annotation: Dehydrated<ast.AnnotationRef>
  ): void {
    node.annotations.push(annotation);
  }
  export function insertAnnotationAt(
    node: Dehydrated<ast.RosettaEnumeration>,
    index: number,
    annotation: Dehydrated<ast.AnnotationRef>
  ): void {
    node.annotations.splice(index, 0, annotation);
  }
  export function removeAnnotationAt(node: Dehydrated<ast.RosettaEnumeration>, index: number): void {
    node.annotations.splice(index, 1);
  }
  export function setAnnotationAt(
    node: Dehydrated<ast.RosettaEnumeration>,
    index: number,
    annotation: Dehydrated<ast.AnnotationRef>
  ): void {
    node.annotations[index] = annotation;
  }
  export function moveAnnotationAt(node: Dehydrated<ast.RosettaEnumeration>, from: number, to: number): void {
    if (from < 0 || from >= node.annotations.length) return;
    const [item] = node.annotations.splice(from, 1);
    if (item === undefined) return;
    node.annotations.splice(to, 0, item);
  }
  export function getSynonyms(node: Dehydrated<ast.RosettaEnumeration>): Dehydrated<ast.RosettaSynonym>[] {
    return node.synonyms;
  }
  export function addSynonym(node: Dehydrated<ast.RosettaEnumeration>, synonym: Dehydrated<ast.RosettaSynonym>): void {
    node.synonyms.push(synonym);
  }
  export function insertSynonymAt(
    node: Dehydrated<ast.RosettaEnumeration>,
    index: number,
    synonym: Dehydrated<ast.RosettaSynonym>
  ): void {
    node.synonyms.splice(index, 0, synonym);
  }
  export function removeSynonymAt(node: Dehydrated<ast.RosettaEnumeration>, index: number): void {
    node.synonyms.splice(index, 1);
  }
  export function setSynonymAt(
    node: Dehydrated<ast.RosettaEnumeration>,
    index: number,
    synonym: Dehydrated<ast.RosettaSynonym>
  ): void {
    node.synonyms[index] = synonym;
  }
  export function moveSynonymAt(node: Dehydrated<ast.RosettaEnumeration>, from: number, to: number): void {
    if (from < 0 || from >= node.synonyms.length) return;
    const [item] = node.synonyms.splice(from, 1);
    if (item === undefined) return;
    node.synonyms.splice(to, 0, item);
  }
}

export type RosettaEnumValue = ast.RosettaEnumValue;
export namespace RosettaEnumValue {
  export function getReferences(node: Dehydrated<ast.RosettaEnumValue>): Dehydrated<ast.RosettaDocReference>[] {
    return node.references;
  }
  export function addReference(
    node: Dehydrated<ast.RosettaEnumValue>,
    reference: Dehydrated<ast.RosettaDocReference>
  ): void {
    node.references.push(reference);
  }
  export function insertReferenceAt(
    node: Dehydrated<ast.RosettaEnumValue>,
    index: number,
    reference: Dehydrated<ast.RosettaDocReference>
  ): void {
    node.references.splice(index, 0, reference);
  }
  export function removeReferenceAt(node: Dehydrated<ast.RosettaEnumValue>, index: number): void {
    node.references.splice(index, 1);
  }
  export function setReferenceAt(
    node: Dehydrated<ast.RosettaEnumValue>,
    index: number,
    reference: Dehydrated<ast.RosettaDocReference>
  ): void {
    node.references[index] = reference;
  }
  export function moveReferenceAt(node: Dehydrated<ast.RosettaEnumValue>, from: number, to: number): void {
    if (from < 0 || from >= node.references.length) return;
    const [item] = node.references.splice(from, 1);
    if (item === undefined) return;
    node.references.splice(to, 0, item);
  }
  export function getAnnotations(node: Dehydrated<ast.RosettaEnumValue>): Dehydrated<ast.AnnotationRef>[] {
    return node.annotations;
  }
  export function addAnnotation(
    node: Dehydrated<ast.RosettaEnumValue>,
    annotation: Dehydrated<ast.AnnotationRef>
  ): void {
    node.annotations.push(annotation);
  }
  export function insertAnnotationAt(
    node: Dehydrated<ast.RosettaEnumValue>,
    index: number,
    annotation: Dehydrated<ast.AnnotationRef>
  ): void {
    node.annotations.splice(index, 0, annotation);
  }
  export function removeAnnotationAt(node: Dehydrated<ast.RosettaEnumValue>, index: number): void {
    node.annotations.splice(index, 1);
  }
  export function setAnnotationAt(
    node: Dehydrated<ast.RosettaEnumValue>,
    index: number,
    annotation: Dehydrated<ast.AnnotationRef>
  ): void {
    node.annotations[index] = annotation;
  }
  export function moveAnnotationAt(node: Dehydrated<ast.RosettaEnumValue>, from: number, to: number): void {
    if (from < 0 || from >= node.annotations.length) return;
    const [item] = node.annotations.splice(from, 1);
    if (item === undefined) return;
    node.annotations.splice(to, 0, item);
  }
  export function getEnumSynonyms(node: Dehydrated<ast.RosettaEnumValue>): Dehydrated<ast.RosettaEnumSynonym>[] {
    return node.enumSynonyms;
  }
  export function addEnumSynonym(
    node: Dehydrated<ast.RosettaEnumValue>,
    enumSynonym: Dehydrated<ast.RosettaEnumSynonym>
  ): void {
    node.enumSynonyms.push(enumSynonym);
  }
  export function insertEnumSynonymAt(
    node: Dehydrated<ast.RosettaEnumValue>,
    index: number,
    enumSynonym: Dehydrated<ast.RosettaEnumSynonym>
  ): void {
    node.enumSynonyms.splice(index, 0, enumSynonym);
  }
  export function removeEnumSynonymAt(node: Dehydrated<ast.RosettaEnumValue>, index: number): void {
    node.enumSynonyms.splice(index, 1);
  }
  export function setEnumSynonymAt(
    node: Dehydrated<ast.RosettaEnumValue>,
    index: number,
    enumSynonym: Dehydrated<ast.RosettaEnumSynonym>
  ): void {
    node.enumSynonyms[index] = enumSynonym;
  }
  export function moveEnumSynonymAt(node: Dehydrated<ast.RosettaEnumValue>, from: number, to: number): void {
    if (from < 0 || from >= node.enumSynonyms.length) return;
    const [item] = node.enumSynonyms.splice(from, 1);
    if (item === undefined) return;
    node.enumSynonyms.splice(to, 0, item);
  }
}

export type RosettaEnumValueReference = ast.RosettaEnumValueReference;
export namespace RosettaEnumValueReference {
  export function setEnumeration(node: Dehydrated<ast.RosettaEnumValueReference>, refText: string): void {
    node.enumeration = { $refText: refText };
  }
  export function setValue(node: Dehydrated<ast.RosettaEnumValueReference>, refText: string): void {
    node.value = { $refText: refText };
  }
}

export type RosettaExternalClass = ast.RosettaExternalClass;
export namespace RosettaExternalClass {
  export function setData(node: Dehydrated<ast.RosettaExternalClass>, refText: string): void {
    node.data = { $refText: refText };
  }
  export function getExternalClassSynonyms(
    node: Dehydrated<ast.RosettaExternalClass>
  ): Dehydrated<ast.RosettaExternalClassSynonym>[] {
    return node.externalClassSynonyms;
  }
  export function addExternalClassSynonym(
    node: Dehydrated<ast.RosettaExternalClass>,
    externalClassSynonym: Dehydrated<ast.RosettaExternalClassSynonym>
  ): void {
    node.externalClassSynonyms.push(externalClassSynonym);
  }
  export function insertExternalClassSynonymAt(
    node: Dehydrated<ast.RosettaExternalClass>,
    index: number,
    externalClassSynonym: Dehydrated<ast.RosettaExternalClassSynonym>
  ): void {
    node.externalClassSynonyms.splice(index, 0, externalClassSynonym);
  }
  export function removeExternalClassSynonymAt(node: Dehydrated<ast.RosettaExternalClass>, index: number): void {
    node.externalClassSynonyms.splice(index, 1);
  }
  export function setExternalClassSynonymAt(
    node: Dehydrated<ast.RosettaExternalClass>,
    index: number,
    externalClassSynonym: Dehydrated<ast.RosettaExternalClassSynonym>
  ): void {
    node.externalClassSynonyms[index] = externalClassSynonym;
  }
  export function moveExternalClassSynonymAt(
    node: Dehydrated<ast.RosettaExternalClass>,
    from: number,
    to: number
  ): void {
    if (from < 0 || from >= node.externalClassSynonyms.length) return;
    const [item] = node.externalClassSynonyms.splice(from, 1);
    if (item === undefined) return;
    node.externalClassSynonyms.splice(to, 0, item);
  }
  export function getRegularAttributes(
    node: Dehydrated<ast.RosettaExternalClass>
  ): Dehydrated<ast.RosettaExternalRegularAttribute>[] {
    return node.regularAttributes;
  }
  export function addRegularAttribute(
    node: Dehydrated<ast.RosettaExternalClass>,
    regularAttribute: Dehydrated<ast.RosettaExternalRegularAttribute>
  ): void {
    node.regularAttributes.push(regularAttribute);
  }
  export function insertRegularAttributeAt(
    node: Dehydrated<ast.RosettaExternalClass>,
    index: number,
    regularAttribute: Dehydrated<ast.RosettaExternalRegularAttribute>
  ): void {
    node.regularAttributes.splice(index, 0, regularAttribute);
  }
  export function removeRegularAttributeAt(node: Dehydrated<ast.RosettaExternalClass>, index: number): void {
    node.regularAttributes.splice(index, 1);
  }
  export function setRegularAttributeAt(
    node: Dehydrated<ast.RosettaExternalClass>,
    index: number,
    regularAttribute: Dehydrated<ast.RosettaExternalRegularAttribute>
  ): void {
    node.regularAttributes[index] = regularAttribute;
  }
  export function moveRegularAttributeAt(node: Dehydrated<ast.RosettaExternalClass>, from: number, to: number): void {
    if (from < 0 || from >= node.regularAttributes.length) return;
    const [item] = node.regularAttributes.splice(from, 1);
    if (item === undefined) return;
    node.regularAttributes.splice(to, 0, item);
  }
}

export type RosettaExternalClassSynonym = ast.RosettaExternalClassSynonym;
export namespace RosettaExternalClassSynonym {
  export function setValue(
    node: Dehydrated<ast.RosettaExternalClassSynonym>,
    value: Dehydrated<ast.RosettaSynonymValueBase>
  ): void {
    node.value = value;
  }
  export function clearValue(node: Dehydrated<ast.RosettaExternalClassSynonym>): void {
    node.value = undefined;
  }
  export function setMetaValue(
    node: Dehydrated<ast.RosettaExternalClassSynonym>,
    metaValue: Dehydrated<ast.RosettaSynonymValueBase>
  ): void {
    node.metaValue = metaValue;
  }
}

export type RosettaExternalEnum = ast.RosettaExternalEnum;
export namespace RosettaExternalEnum {
  export function setEnumeration(node: Dehydrated<ast.RosettaExternalEnum>, refText: string): void {
    node.enumeration = { $refText: refText };
  }
  export function getRegularValues(
    node: Dehydrated<ast.RosettaExternalEnum>
  ): Dehydrated<ast.RosettaExternalEnumValue>[] {
    return node.regularValues;
  }
  export function addRegularValue(
    node: Dehydrated<ast.RosettaExternalEnum>,
    regularValue: Dehydrated<ast.RosettaExternalEnumValue>
  ): void {
    node.regularValues.push(regularValue);
  }
  export function insertRegularValueAt(
    node: Dehydrated<ast.RosettaExternalEnum>,
    index: number,
    regularValue: Dehydrated<ast.RosettaExternalEnumValue>
  ): void {
    node.regularValues.splice(index, 0, regularValue);
  }
  export function removeRegularValueAt(node: Dehydrated<ast.RosettaExternalEnum>, index: number): void {
    node.regularValues.splice(index, 1);
  }
  export function setRegularValueAt(
    node: Dehydrated<ast.RosettaExternalEnum>,
    index: number,
    regularValue: Dehydrated<ast.RosettaExternalEnumValue>
  ): void {
    node.regularValues[index] = regularValue;
  }
  export function moveRegularValueAt(node: Dehydrated<ast.RosettaExternalEnum>, from: number, to: number): void {
    if (from < 0 || from >= node.regularValues.length) return;
    const [item] = node.regularValues.splice(from, 1);
    if (item === undefined) return;
    node.regularValues.splice(to, 0, item);
  }
}

export type RosettaExternalEnumValue = ast.RosettaExternalEnumValue;
export namespace RosettaExternalEnumValue {
  export function setEnumRef(node: Dehydrated<ast.RosettaExternalEnumValue>, refText: string): void {
    node.enumRef = { $refText: refText };
  }
  export function getExternalEnumSynonyms(
    node: Dehydrated<ast.RosettaExternalEnumValue>
  ): Dehydrated<ast.RosettaEnumSynonym>[] {
    return node.externalEnumSynonyms;
  }
  export function addExternalEnumSynonym(
    node: Dehydrated<ast.RosettaExternalEnumValue>,
    externalEnumSynonym: Dehydrated<ast.RosettaEnumSynonym>
  ): void {
    node.externalEnumSynonyms.push(externalEnumSynonym);
  }
  export function insertExternalEnumSynonymAt(
    node: Dehydrated<ast.RosettaExternalEnumValue>,
    index: number,
    externalEnumSynonym: Dehydrated<ast.RosettaEnumSynonym>
  ): void {
    node.externalEnumSynonyms.splice(index, 0, externalEnumSynonym);
  }
  export function removeExternalEnumSynonymAt(node: Dehydrated<ast.RosettaExternalEnumValue>, index: number): void {
    node.externalEnumSynonyms.splice(index, 1);
  }
  export function setExternalEnumSynonymAt(
    node: Dehydrated<ast.RosettaExternalEnumValue>,
    index: number,
    externalEnumSynonym: Dehydrated<ast.RosettaEnumSynonym>
  ): void {
    node.externalEnumSynonyms[index] = externalEnumSynonym;
  }
  export function moveExternalEnumSynonymAt(
    node: Dehydrated<ast.RosettaExternalEnumValue>,
    from: number,
    to: number
  ): void {
    if (from < 0 || from >= node.externalEnumSynonyms.length) return;
    const [item] = node.externalEnumSynonyms.splice(from, 1);
    if (item === undefined) return;
    node.externalEnumSynonyms.splice(to, 0, item);
  }
}

export type RosettaExternalFunction = ast.RosettaExternalFunction;
export namespace RosettaExternalFunction {
  export function setTypeCall(node: Dehydrated<ast.RosettaExternalFunction>, typeCall: Dehydrated<ast.TypeCall>): void {
    node.typeCall = typeCall;
  }
  export function getParameters(node: Dehydrated<ast.RosettaExternalFunction>): Dehydrated<ast.RosettaParameter>[] {
    return node.parameters;
  }
  export function addParameter(
    node: Dehydrated<ast.RosettaExternalFunction>,
    parameter: Dehydrated<ast.RosettaParameter>
  ): void {
    node.parameters.push(parameter);
  }
  export function insertParameterAt(
    node: Dehydrated<ast.RosettaExternalFunction>,
    index: number,
    parameter: Dehydrated<ast.RosettaParameter>
  ): void {
    node.parameters.splice(index, 0, parameter);
  }
  export function removeParameterAt(node: Dehydrated<ast.RosettaExternalFunction>, index: number): void {
    node.parameters.splice(index, 1);
  }
  export function setParameterAt(
    node: Dehydrated<ast.RosettaExternalFunction>,
    index: number,
    parameter: Dehydrated<ast.RosettaParameter>
  ): void {
    node.parameters[index] = parameter;
  }
  export function moveParameterAt(node: Dehydrated<ast.RosettaExternalFunction>, from: number, to: number): void {
    if (from < 0 || from >= node.parameters.length) return;
    const [item] = node.parameters.splice(from, 1);
    if (item === undefined) return;
    node.parameters.splice(to, 0, item);
  }
}

export type RosettaExternalRegularAttribute = ast.RosettaExternalRegularAttribute;
export namespace RosettaExternalRegularAttribute {
  export function setAttributeRef(node: Dehydrated<ast.RosettaExternalRegularAttribute>, refText: string): void {
    node.attributeRef = { $refText: refText };
  }
  export function getExternalSynonyms(
    node: Dehydrated<ast.RosettaExternalRegularAttribute>
  ): Dehydrated<ast.RosettaExternalSynonym>[] {
    return node.externalSynonyms;
  }
  export function addExternalSynonym(
    node: Dehydrated<ast.RosettaExternalRegularAttribute>,
    externalSynonym: Dehydrated<ast.RosettaExternalSynonym>
  ): void {
    node.externalSynonyms.push(externalSynonym);
  }
  export function insertExternalSynonymAt(
    node: Dehydrated<ast.RosettaExternalRegularAttribute>,
    index: number,
    externalSynonym: Dehydrated<ast.RosettaExternalSynonym>
  ): void {
    node.externalSynonyms.splice(index, 0, externalSynonym);
  }
  export function removeExternalSynonymAt(node: Dehydrated<ast.RosettaExternalRegularAttribute>, index: number): void {
    node.externalSynonyms.splice(index, 1);
  }
  export function setExternalSynonymAt(
    node: Dehydrated<ast.RosettaExternalRegularAttribute>,
    index: number,
    externalSynonym: Dehydrated<ast.RosettaExternalSynonym>
  ): void {
    node.externalSynonyms[index] = externalSynonym;
  }
  export function moveExternalSynonymAt(
    node: Dehydrated<ast.RosettaExternalRegularAttribute>,
    from: number,
    to: number
  ): void {
    if (from < 0 || from >= node.externalSynonyms.length) return;
    const [item] = node.externalSynonyms.splice(from, 1);
    if (item === undefined) return;
    node.externalSynonyms.splice(to, 0, item);
  }
  export function getExternalRuleReferences(
    node: Dehydrated<ast.RosettaExternalRegularAttribute>
  ): Dehydrated<ast.RuleReferenceAnnotation>[] {
    return node.externalRuleReferences;
  }
  export function addExternalRuleReference(
    node: Dehydrated<ast.RosettaExternalRegularAttribute>,
    externalRuleReference: Dehydrated<ast.RuleReferenceAnnotation>
  ): void {
    node.externalRuleReferences.push(externalRuleReference);
  }
  export function insertExternalRuleReferenceAt(
    node: Dehydrated<ast.RosettaExternalRegularAttribute>,
    index: number,
    externalRuleReference: Dehydrated<ast.RuleReferenceAnnotation>
  ): void {
    node.externalRuleReferences.splice(index, 0, externalRuleReference);
  }
  export function removeExternalRuleReferenceAt(
    node: Dehydrated<ast.RosettaExternalRegularAttribute>,
    index: number
  ): void {
    node.externalRuleReferences.splice(index, 1);
  }
  export function setExternalRuleReferenceAt(
    node: Dehydrated<ast.RosettaExternalRegularAttribute>,
    index: number,
    externalRuleReference: Dehydrated<ast.RuleReferenceAnnotation>
  ): void {
    node.externalRuleReferences[index] = externalRuleReference;
  }
  export function moveExternalRuleReferenceAt(
    node: Dehydrated<ast.RosettaExternalRegularAttribute>,
    from: number,
    to: number
  ): void {
    if (from < 0 || from >= node.externalRuleReferences.length) return;
    const [item] = node.externalRuleReferences.splice(from, 1);
    if (item === undefined) return;
    node.externalRuleReferences.splice(to, 0, item);
  }
}

export type RosettaExternalRuleSource = ast.RosettaExternalRuleSource;
export namespace RosettaExternalRuleSource {
  export function getExternalClasses(
    node: Dehydrated<ast.RosettaExternalRuleSource>
  ): Dehydrated<ast.RosettaExternalClass>[] {
    return node.externalClasses;
  }
  export function addExternalClasse(
    node: Dehydrated<ast.RosettaExternalRuleSource>,
    externalClasse: Dehydrated<ast.RosettaExternalClass>
  ): void {
    node.externalClasses.push(externalClasse);
  }
  export function insertExternalClasseAt(
    node: Dehydrated<ast.RosettaExternalRuleSource>,
    index: number,
    externalClasse: Dehydrated<ast.RosettaExternalClass>
  ): void {
    node.externalClasses.splice(index, 0, externalClasse);
  }
  export function removeExternalClasseAt(node: Dehydrated<ast.RosettaExternalRuleSource>, index: number): void {
    node.externalClasses.splice(index, 1);
  }
  export function setExternalClasseAt(
    node: Dehydrated<ast.RosettaExternalRuleSource>,
    index: number,
    externalClasse: Dehydrated<ast.RosettaExternalClass>
  ): void {
    node.externalClasses[index] = externalClasse;
  }
  export function moveExternalClasseAt(
    node: Dehydrated<ast.RosettaExternalRuleSource>,
    from: number,
    to: number
  ): void {
    if (from < 0 || from >= node.externalClasses.length) return;
    const [item] = node.externalClasses.splice(from, 1);
    if (item === undefined) return;
    node.externalClasses.splice(to, 0, item);
  }
  export function getExternalEnums(
    node: Dehydrated<ast.RosettaExternalRuleSource>
  ): Dehydrated<ast.RosettaExternalEnum>[] {
    return node.externalEnums;
  }
  export function addExternalEnum(
    node: Dehydrated<ast.RosettaExternalRuleSource>,
    externalEnum: Dehydrated<ast.RosettaExternalEnum>
  ): void {
    node.externalEnums.push(externalEnum);
  }
  export function insertExternalEnumAt(
    node: Dehydrated<ast.RosettaExternalRuleSource>,
    index: number,
    externalEnum: Dehydrated<ast.RosettaExternalEnum>
  ): void {
    node.externalEnums.splice(index, 0, externalEnum);
  }
  export function removeExternalEnumAt(node: Dehydrated<ast.RosettaExternalRuleSource>, index: number): void {
    node.externalEnums.splice(index, 1);
  }
  export function setExternalEnumAt(
    node: Dehydrated<ast.RosettaExternalRuleSource>,
    index: number,
    externalEnum: Dehydrated<ast.RosettaExternalEnum>
  ): void {
    node.externalEnums[index] = externalEnum;
  }
  export function moveExternalEnumAt(node: Dehydrated<ast.RosettaExternalRuleSource>, from: number, to: number): void {
    if (from < 0 || from >= node.externalEnums.length) return;
    const [item] = node.externalEnums.splice(from, 1);
    if (item === undefined) return;
    node.externalEnums.splice(to, 0, item);
  }
}

export type RosettaExternalSynonym = ast.RosettaExternalSynonym;
export namespace RosettaExternalSynonym {
  export function setBody(
    node: Dehydrated<ast.RosettaExternalSynonym>,
    body: Dehydrated<ast.RosettaSynonymBody>
  ): void {
    node.body = body;
  }
}

export type RosettaFeatureCall = ast.RosettaFeatureCall;
export namespace RosettaFeatureCall {
  export function setFeature(node: Dehydrated<ast.RosettaFeatureCall>, refText: string): void {
    node.feature = { $refText: refText };
  }
  export function clearFeature(node: Dehydrated<ast.RosettaFeatureCall>): void {
    node.feature = undefined;
  }
}

export type RosettaFunction = ast.RosettaFunction;
export namespace RosettaFunction {
  export function setDispatchAttribute(node: Dehydrated<ast.RosettaFunction>, refText: string): void {
    node.dispatchAttribute = { $refText: refText };
  }
  export function clearDispatchAttribute(node: Dehydrated<ast.RosettaFunction>): void {
    node.dispatchAttribute = undefined;
  }
  export function setDispatchValue(
    node: Dehydrated<ast.RosettaFunction>,
    dispatchValue: Dehydrated<ast.RosettaEnumValueReference>
  ): void {
    node.dispatchValue = dispatchValue;
  }
  export function clearDispatchValue(node: Dehydrated<ast.RosettaFunction>): void {
    node.dispatchValue = undefined;
  }
  export function setSuperFunction(node: Dehydrated<ast.RosettaFunction>, refText: string): void {
    node.superFunction = { $refText: refText };
  }
  export function clearSuperFunction(node: Dehydrated<ast.RosettaFunction>): void {
    node.superFunction = undefined;
  }
  export function getReferences(node: Dehydrated<ast.RosettaFunction>): Dehydrated<ast.RosettaDocReference>[] {
    return node.references;
  }
  export function addReference(
    node: Dehydrated<ast.RosettaFunction>,
    reference: Dehydrated<ast.RosettaDocReference>
  ): void {
    node.references.push(reference);
  }
  export function insertReferenceAt(
    node: Dehydrated<ast.RosettaFunction>,
    index: number,
    reference: Dehydrated<ast.RosettaDocReference>
  ): void {
    node.references.splice(index, 0, reference);
  }
  export function removeReferenceAt(node: Dehydrated<ast.RosettaFunction>, index: number): void {
    node.references.splice(index, 1);
  }
  export function setReferenceAt(
    node: Dehydrated<ast.RosettaFunction>,
    index: number,
    reference: Dehydrated<ast.RosettaDocReference>
  ): void {
    node.references[index] = reference;
  }
  export function moveReferenceAt(node: Dehydrated<ast.RosettaFunction>, from: number, to: number): void {
    if (from < 0 || from >= node.references.length) return;
    const [item] = node.references.splice(from, 1);
    if (item === undefined) return;
    node.references.splice(to, 0, item);
  }
  export function getAnnotations(node: Dehydrated<ast.RosettaFunction>): Dehydrated<ast.AnnotationRef>[] {
    return node.annotations;
  }
  export function addAnnotation(
    node: Dehydrated<ast.RosettaFunction>,
    annotation: Dehydrated<ast.AnnotationRef>
  ): void {
    node.annotations.push(annotation);
  }
  export function insertAnnotationAt(
    node: Dehydrated<ast.RosettaFunction>,
    index: number,
    annotation: Dehydrated<ast.AnnotationRef>
  ): void {
    node.annotations.splice(index, 0, annotation);
  }
  export function removeAnnotationAt(node: Dehydrated<ast.RosettaFunction>, index: number): void {
    node.annotations.splice(index, 1);
  }
  export function setAnnotationAt(
    node: Dehydrated<ast.RosettaFunction>,
    index: number,
    annotation: Dehydrated<ast.AnnotationRef>
  ): void {
    node.annotations[index] = annotation;
  }
  export function moveAnnotationAt(node: Dehydrated<ast.RosettaFunction>, from: number, to: number): void {
    if (from < 0 || from >= node.annotations.length) return;
    const [item] = node.annotations.splice(from, 1);
    if (item === undefined) return;
    node.annotations.splice(to, 0, item);
  }
  export function getInputs(node: Dehydrated<ast.RosettaFunction>): Dehydrated<ast.Attribute>[] {
    return node.inputs;
  }
  export function addInput(node: Dehydrated<ast.RosettaFunction>, input: Dehydrated<ast.Attribute>): void {
    node.inputs.push(input);
  }
  export function insertInputAt(
    node: Dehydrated<ast.RosettaFunction>,
    index: number,
    input: Dehydrated<ast.Attribute>
  ): void {
    node.inputs.splice(index, 0, input);
  }
  export function removeInputAt(node: Dehydrated<ast.RosettaFunction>, index: number): void {
    node.inputs.splice(index, 1);
  }
  export function setInputAt(
    node: Dehydrated<ast.RosettaFunction>,
    index: number,
    input: Dehydrated<ast.Attribute>
  ): void {
    node.inputs[index] = input;
  }
  export function moveInputAt(node: Dehydrated<ast.RosettaFunction>, from: number, to: number): void {
    if (from < 0 || from >= node.inputs.length) return;
    const [item] = node.inputs.splice(from, 1);
    if (item === undefined) return;
    node.inputs.splice(to, 0, item);
  }
  export function removeInput(node: Dehydrated<ast.RosettaFunction>, input: Dehydrated<ast.Attribute>): boolean {
    const __k = input.name;
    const __i = node.inputs.findIndex((e) => e.name === __k);
    if (__i < 0) return false;
    node.inputs.splice(__i, 1);
    return true;
  }
  export function setOutput(node: Dehydrated<ast.RosettaFunction>, output: Dehydrated<ast.Attribute>): void {
    node.output = output;
  }
  export function clearOutput(node: Dehydrated<ast.RosettaFunction>): void {
    node.output = undefined;
  }
  export function getShortcuts(node: Dehydrated<ast.RosettaFunction>): Dehydrated<ast.ShortcutDeclaration>[] {
    return node.shortcuts;
  }
  export function addShortcut(
    node: Dehydrated<ast.RosettaFunction>,
    shortcut: Dehydrated<ast.ShortcutDeclaration>
  ): void {
    node.shortcuts.push(shortcut);
  }
  export function insertShortcutAt(
    node: Dehydrated<ast.RosettaFunction>,
    index: number,
    shortcut: Dehydrated<ast.ShortcutDeclaration>
  ): void {
    node.shortcuts.splice(index, 0, shortcut);
  }
  export function removeShortcutAt(node: Dehydrated<ast.RosettaFunction>, index: number): void {
    node.shortcuts.splice(index, 1);
  }
  export function setShortcutAt(
    node: Dehydrated<ast.RosettaFunction>,
    index: number,
    shortcut: Dehydrated<ast.ShortcutDeclaration>
  ): void {
    node.shortcuts[index] = shortcut;
  }
  export function moveShortcutAt(node: Dehydrated<ast.RosettaFunction>, from: number, to: number): void {
    if (from < 0 || from >= node.shortcuts.length) return;
    const [item] = node.shortcuts.splice(from, 1);
    if (item === undefined) return;
    node.shortcuts.splice(to, 0, item);
  }
  export function getConditions(node: Dehydrated<ast.RosettaFunction>): Dehydrated<ast.Condition>[] {
    return node.conditions;
  }
  export function addCondition(node: Dehydrated<ast.RosettaFunction>, condition: Dehydrated<ast.Condition>): void {
    node.conditions.push(condition);
  }
  export function insertConditionAt(
    node: Dehydrated<ast.RosettaFunction>,
    index: number,
    condition: Dehydrated<ast.Condition>
  ): void {
    node.conditions.splice(index, 0, condition);
  }
  export function removeConditionAt(node: Dehydrated<ast.RosettaFunction>, index: number): void {
    node.conditions.splice(index, 1);
  }
  export function setConditionAt(
    node: Dehydrated<ast.RosettaFunction>,
    index: number,
    condition: Dehydrated<ast.Condition>
  ): void {
    node.conditions[index] = condition;
  }
  export function moveConditionAt(node: Dehydrated<ast.RosettaFunction>, from: number, to: number): void {
    if (from < 0 || from >= node.conditions.length) return;
    const [item] = node.conditions.splice(from, 1);
    if (item === undefined) return;
    node.conditions.splice(to, 0, item);
  }
  export function getOperations(node: Dehydrated<ast.RosettaFunction>): Dehydrated<ast.Operation>[] {
    return node.operations;
  }
  export function addOperation(node: Dehydrated<ast.RosettaFunction>, operation: Dehydrated<ast.Operation>): void {
    node.operations.push(operation);
  }
  export function insertOperationAt(
    node: Dehydrated<ast.RosettaFunction>,
    index: number,
    operation: Dehydrated<ast.Operation>
  ): void {
    node.operations.splice(index, 0, operation);
  }
  export function removeOperationAt(node: Dehydrated<ast.RosettaFunction>, index: number): void {
    node.operations.splice(index, 1);
  }
  export function setOperationAt(
    node: Dehydrated<ast.RosettaFunction>,
    index: number,
    operation: Dehydrated<ast.Operation>
  ): void {
    node.operations[index] = operation;
  }
  export function moveOperationAt(node: Dehydrated<ast.RosettaFunction>, from: number, to: number): void {
    if (from < 0 || from >= node.operations.length) return;
    const [item] = node.operations.splice(from, 1);
    if (item === undefined) return;
    node.operations.splice(to, 0, item);
  }
  export function getPostConditions(node: Dehydrated<ast.RosettaFunction>): Dehydrated<ast.Condition>[] {
    return node.postConditions;
  }
  export function addPostCondition(
    node: Dehydrated<ast.RosettaFunction>,
    postCondition: Dehydrated<ast.Condition>
  ): void {
    node.postConditions.push(postCondition);
  }
  export function insertPostConditionAt(
    node: Dehydrated<ast.RosettaFunction>,
    index: number,
    postCondition: Dehydrated<ast.Condition>
  ): void {
    node.postConditions.splice(index, 0, postCondition);
  }
  export function removePostConditionAt(node: Dehydrated<ast.RosettaFunction>, index: number): void {
    node.postConditions.splice(index, 1);
  }
  export function setPostConditionAt(
    node: Dehydrated<ast.RosettaFunction>,
    index: number,
    postCondition: Dehydrated<ast.Condition>
  ): void {
    node.postConditions[index] = postCondition;
  }
  export function movePostConditionAt(node: Dehydrated<ast.RosettaFunction>, from: number, to: number): void {
    if (from < 0 || from >= node.postConditions.length) return;
    const [item] = node.postConditions.splice(from, 1);
    if (item === undefined) return;
    node.postConditions.splice(to, 0, item);
  }
}

export type RosettaMapPath = ast.RosettaMapPath;
export namespace RosettaMapPath {
  export function setPath(node: Dehydrated<ast.RosettaMapPath>, path: Dehydrated<ast.RosettaMapPathValue>): void {
    node.path = path;
  }
}

export type RosettaMapping = ast.RosettaMapping;
export namespace RosettaMapping {
  export function getInstances(node: Dehydrated<ast.RosettaMapping>): Dehydrated<ast.RosettaMappingInstance>[] {
    return node.instances;
  }
  export function addInstance(
    node: Dehydrated<ast.RosettaMapping>,
    instance: Dehydrated<ast.RosettaMappingInstance>
  ): void {
    node.instances.push(instance);
  }
  export function insertInstanceAt(
    node: Dehydrated<ast.RosettaMapping>,
    index: number,
    instance: Dehydrated<ast.RosettaMappingInstance>
  ): void {
    node.instances.splice(index, 0, instance);
  }
  export function removeInstanceAt(node: Dehydrated<ast.RosettaMapping>, index: number): void {
    node.instances.splice(index, 1);
  }
  export function setInstanceAt(
    node: Dehydrated<ast.RosettaMapping>,
    index: number,
    instance: Dehydrated<ast.RosettaMappingInstance>
  ): void {
    node.instances[index] = instance;
  }
  export function moveInstanceAt(node: Dehydrated<ast.RosettaMapping>, from: number, to: number): void {
    if (from < 0 || from >= node.instances.length) return;
    const [item] = node.instances.splice(from, 1);
    if (item === undefined) return;
    node.instances.splice(to, 0, item);
  }
}

export type RosettaMappingInstance = ast.RosettaMappingInstance;
export namespace RosettaMappingInstance {
  export function setWhen(
    node: Dehydrated<ast.RosettaMappingInstance>,
    when: Dehydrated<ast.RosettaMappingPathTests>
  ): void {
    node.when = when;
  }
  export function clearWhen(node: Dehydrated<ast.RosettaMappingInstance>): void {
    node.when = undefined;
  }
}

export type RosettaMapRosettaPath = ast.RosettaMapRosettaPath;
export namespace RosettaMapRosettaPath {
  export function setPath(
    node: Dehydrated<ast.RosettaMapRosettaPath>,
    path: Dehydrated<ast.RosettaAttributeReference>
  ): void {
    node.path = path;
  }
}

export type RosettaMapTestAbsentExpression = ast.RosettaMapTestAbsentExpression;
export namespace RosettaMapTestAbsentExpression {
  export function setArgument(
    node: Dehydrated<ast.RosettaMapTestAbsentExpression>,
    argument: Dehydrated<ast.RosettaMapPathValue>
  ): void {
    node.argument = argument;
  }
}

export type RosettaMapTestEqualityOperation = ast.RosettaMapTestEqualityOperation;
export namespace RosettaMapTestEqualityOperation {
  export function setLeft(
    node: Dehydrated<ast.RosettaMapTestEqualityOperation>,
    left: Dehydrated<ast.RosettaMapPathValue>
  ): void {
    node.left = left;
  }
}

export type RosettaMapTestExistsExpression = ast.RosettaMapTestExistsExpression;
export namespace RosettaMapTestExistsExpression {
  export function setArgument(
    node: Dehydrated<ast.RosettaMapTestExistsExpression>,
    argument: Dehydrated<ast.RosettaMapPathValue>
  ): void {
    node.argument = argument;
  }
}

export type RosettaMapTestFunc = ast.RosettaMapTestFunc;
export namespace RosettaMapTestFunc {
  export function setFunc(node: Dehydrated<ast.RosettaMapTestFunc>, refText: string): void {
    node.func = { $refText: refText };
  }
  export function setPredicatePath(
    node: Dehydrated<ast.RosettaMapTestFunc>,
    predicatePath: Dehydrated<ast.RosettaMapPathValue>
  ): void {
    node.predicatePath = predicatePath;
  }
  export function clearPredicatePath(node: Dehydrated<ast.RosettaMapTestFunc>): void {
    node.predicatePath = undefined;
  }
}

export type RosettaMetaType = ast.RosettaMetaType;
export namespace RosettaMetaType {
  export function setTypeCall(node: Dehydrated<ast.RosettaMetaType>, typeCall: Dehydrated<ast.TypeCall>): void {
    node.typeCall = typeCall;
  }
}

export type RosettaModel = ast.RosettaModel;
export namespace RosettaModel {
  export function setScope(node: Dehydrated<ast.RosettaModel>, scope: Dehydrated<ast.RosettaScope>): void {
    node.scope = scope;
  }
  export function clearScope(node: Dehydrated<ast.RosettaModel>): void {
    node.scope = undefined;
  }
  export function getImports(node: Dehydrated<ast.RosettaModel>): Dehydrated<ast.Import>[] {
    return node.imports;
  }
  export function addImport(node: Dehydrated<ast.RosettaModel>, import_: Dehydrated<ast.Import>): void {
    node.imports.push(import_);
  }
  export function insertImportAt(
    node: Dehydrated<ast.RosettaModel>,
    index: number,
    import_: Dehydrated<ast.Import>
  ): void {
    node.imports.splice(index, 0, import_);
  }
  export function removeImportAt(node: Dehydrated<ast.RosettaModel>, index: number): void {
    node.imports.splice(index, 1);
  }
  export function setImportAt(
    node: Dehydrated<ast.RosettaModel>,
    index: number,
    import_: Dehydrated<ast.Import>
  ): void {
    node.imports[index] = import_;
  }
  export function moveImportAt(node: Dehydrated<ast.RosettaModel>, from: number, to: number): void {
    if (from < 0 || from >= node.imports.length) return;
    const [item] = node.imports.splice(from, 1);
    if (item === undefined) return;
    node.imports.splice(to, 0, item);
  }
  export function getConfigurations(
    node: Dehydrated<ast.RosettaModel>
  ): Dehydrated<ast.RosettaQualifiableConfiguration>[] {
    return node.configurations;
  }
  export function addConfiguration(
    node: Dehydrated<ast.RosettaModel>,
    configuration: Dehydrated<ast.RosettaQualifiableConfiguration>
  ): void {
    node.configurations.push(configuration);
  }
  export function insertConfigurationAt(
    node: Dehydrated<ast.RosettaModel>,
    index: number,
    configuration: Dehydrated<ast.RosettaQualifiableConfiguration>
  ): void {
    node.configurations.splice(index, 0, configuration);
  }
  export function removeConfigurationAt(node: Dehydrated<ast.RosettaModel>, index: number): void {
    node.configurations.splice(index, 1);
  }
  export function setConfigurationAt(
    node: Dehydrated<ast.RosettaModel>,
    index: number,
    configuration: Dehydrated<ast.RosettaQualifiableConfiguration>
  ): void {
    node.configurations[index] = configuration;
  }
  export function moveConfigurationAt(node: Dehydrated<ast.RosettaModel>, from: number, to: number): void {
    if (from < 0 || from >= node.configurations.length) return;
    const [item] = node.configurations.splice(from, 1);
    if (item === undefined) return;
    node.configurations.splice(to, 0, item);
  }
}

export type RosettaParameter = ast.RosettaParameter;
export namespace RosettaParameter {
  export function setTypeCall(node: Dehydrated<ast.RosettaParameter>, typeCall: Dehydrated<ast.TypeCall>): void {
    node.typeCall = typeCall;
  }
}

export type RosettaQualifiableConfiguration = ast.RosettaQualifiableConfiguration;
export namespace RosettaQualifiableConfiguration {
  export function setRosettaClass(node: Dehydrated<ast.RosettaQualifiableConfiguration>, refText: string): void {
    node.rosettaClass = { $refText: refText };
  }
}

export type RosettaRecordFeature = ast.RosettaRecordFeature;
export namespace RosettaRecordFeature {
  export function setTypeCall(node: Dehydrated<ast.RosettaRecordFeature>, typeCall: Dehydrated<ast.TypeCall>): void {
    node.typeCall = typeCall;
  }
}

export type RosettaRecordType = ast.RosettaRecordType;
export namespace RosettaRecordType {
  export function getFeatures(node: Dehydrated<ast.RosettaRecordType>): Dehydrated<ast.RosettaRecordFeature>[] {
    return node.features;
  }
  export function addFeature(
    node: Dehydrated<ast.RosettaRecordType>,
    feature: Dehydrated<ast.RosettaRecordFeature>
  ): void {
    node.features.push(feature);
  }
  export function insertFeatureAt(
    node: Dehydrated<ast.RosettaRecordType>,
    index: number,
    feature: Dehydrated<ast.RosettaRecordFeature>
  ): void {
    node.features.splice(index, 0, feature);
  }
  export function removeFeatureAt(node: Dehydrated<ast.RosettaRecordType>, index: number): void {
    node.features.splice(index, 1);
  }
  export function setFeatureAt(
    node: Dehydrated<ast.RosettaRecordType>,
    index: number,
    feature: Dehydrated<ast.RosettaRecordFeature>
  ): void {
    node.features[index] = feature;
  }
  export function moveFeatureAt(node: Dehydrated<ast.RosettaRecordType>, from: number, to: number): void {
    if (from < 0 || from >= node.features.length) return;
    const [item] = node.features.splice(from, 1);
    if (item === undefined) return;
    node.features.splice(to, 0, item);
  }
}

export type RosettaReport = ast.RosettaReport;
export namespace RosettaReport {
  export function setRegulatoryBody(
    node: Dehydrated<ast.RosettaReport>,
    regulatoryBody: Dehydrated<ast.RegulatoryDocumentReference>
  ): void {
    node.regulatoryBody = regulatoryBody;
  }
  export function setInputType(node: Dehydrated<ast.RosettaReport>, inputType: Dehydrated<ast.TypeCall>): void {
    node.inputType = inputType;
  }
  export function setReportingStandard(node: Dehydrated<ast.RosettaReport>, refText: string): void {
    node.reportingStandard = { $refText: refText };
  }
  export function clearReportingStandard(node: Dehydrated<ast.RosettaReport>): void {
    node.reportingStandard = undefined;
  }
  export function setReportType(node: Dehydrated<ast.RosettaReport>, refText: string): void {
    node.reportType = { $refText: refText };
  }
  export function setRuleSource(node: Dehydrated<ast.RosettaReport>, refText: string): void {
    node.ruleSource = { $refText: refText };
  }
  export function clearRuleSource(node: Dehydrated<ast.RosettaReport>): void {
    node.ruleSource = undefined;
  }
}

export type RosettaRule = ast.RosettaRule;
export namespace RosettaRule {
  export function setInput(node: Dehydrated<ast.RosettaRule>, input: Dehydrated<ast.TypeCall>): void {
    node.input = input;
  }
  export function clearInput(node: Dehydrated<ast.RosettaRule>): void {
    node.input = undefined;
  }
  export function getReferences(node: Dehydrated<ast.RosettaRule>): Dehydrated<ast.RosettaDocReference>[] {
    return node.references;
  }
  export function addReference(
    node: Dehydrated<ast.RosettaRule>,
    reference: Dehydrated<ast.RosettaDocReference>
  ): void {
    node.references.push(reference);
  }
  export function insertReferenceAt(
    node: Dehydrated<ast.RosettaRule>,
    index: number,
    reference: Dehydrated<ast.RosettaDocReference>
  ): void {
    node.references.splice(index, 0, reference);
  }
  export function removeReferenceAt(node: Dehydrated<ast.RosettaRule>, index: number): void {
    node.references.splice(index, 1);
  }
  export function setReferenceAt(
    node: Dehydrated<ast.RosettaRule>,
    index: number,
    reference: Dehydrated<ast.RosettaDocReference>
  ): void {
    node.references[index] = reference;
  }
  export function moveReferenceAt(node: Dehydrated<ast.RosettaRule>, from: number, to: number): void {
    if (from < 0 || from >= node.references.length) return;
    const [item] = node.references.splice(from, 1);
    if (item === undefined) return;
    node.references.splice(to, 0, item);
  }
}

export type RosettaSegmentRef = ast.RosettaSegmentRef;
export namespace RosettaSegmentRef {
  export function setSegment(node: Dehydrated<ast.RosettaSegmentRef>, refText: string): void {
    node.segment = { $refText: refText };
  }
}

export type RosettaSymbolReference = ast.RosettaSymbolReference;
export namespace RosettaSymbolReference {
  export function setSymbol(node: Dehydrated<ast.RosettaSymbolReference>, refText: string): void {
    node.symbol = { $refText: refText };
  }
}

export type RosettaSynonym = ast.RosettaSynonym;
export namespace RosettaSynonym {
  export function setBody(node: Dehydrated<ast.RosettaSynonym>, body: Dehydrated<ast.RosettaSynonymBody>): void {
    node.body = body;
  }
}

export type RosettaSynonymBody = ast.RosettaSynonymBody;
export namespace RosettaSynonymBody {
  export function setMerge(
    node: Dehydrated<ast.RosettaSynonymBody>,
    merge: Dehydrated<ast.RosettaMergeSynonymValue>
  ): void {
    node.merge = merge;
  }
  export function clearMerge(node: Dehydrated<ast.RosettaSynonymBody>): void {
    node.merge = undefined;
  }
  export function setMappingLogic(
    node: Dehydrated<ast.RosettaSynonymBody>,
    mappingLogic: Dehydrated<ast.RosettaMapping>
  ): void {
    node.mappingLogic = mappingLogic;
  }
  export function clearMappingLogic(node: Dehydrated<ast.RosettaSynonymBody>): void {
    node.mappingLogic = undefined;
  }
  export function getValues(node: Dehydrated<ast.RosettaSynonymBody>): Dehydrated<ast.RosettaSynonymValueBase>[] {
    return node.values;
  }
  export function addValue(
    node: Dehydrated<ast.RosettaSynonymBody>,
    value: Dehydrated<ast.RosettaSynonymValueBase>
  ): void {
    node.values.push(value);
  }
  export function insertValueAt(
    node: Dehydrated<ast.RosettaSynonymBody>,
    index: number,
    value: Dehydrated<ast.RosettaSynonymValueBase>
  ): void {
    node.values.splice(index, 0, value);
  }
  export function removeValueAt(node: Dehydrated<ast.RosettaSynonymBody>, index: number): void {
    node.values.splice(index, 1);
  }
  export function setValueAt(
    node: Dehydrated<ast.RosettaSynonymBody>,
    index: number,
    value: Dehydrated<ast.RosettaSynonymValueBase>
  ): void {
    node.values[index] = value;
  }
  export function moveValueAt(node: Dehydrated<ast.RosettaSynonymBody>, from: number, to: number): void {
    if (from < 0 || from >= node.values.length) return;
    const [item] = node.values.splice(from, 1);
    if (item === undefined) return;
    node.values.splice(to, 0, item);
  }
}

export type RosettaSynonymSource = ast.RosettaSynonymSource;
export namespace RosettaSynonymSource {
  export function getExternalClasses(
    node: Dehydrated<ast.RosettaSynonymSource>
  ): Dehydrated<ast.RosettaExternalClass>[] {
    return node.externalClasses;
  }
  export function addExternalClasse(
    node: Dehydrated<ast.RosettaSynonymSource>,
    externalClasse: Dehydrated<ast.RosettaExternalClass>
  ): void {
    node.externalClasses.push(externalClasse);
  }
  export function insertExternalClasseAt(
    node: Dehydrated<ast.RosettaSynonymSource>,
    index: number,
    externalClasse: Dehydrated<ast.RosettaExternalClass>
  ): void {
    node.externalClasses.splice(index, 0, externalClasse);
  }
  export function removeExternalClasseAt(node: Dehydrated<ast.RosettaSynonymSource>, index: number): void {
    node.externalClasses.splice(index, 1);
  }
  export function setExternalClasseAt(
    node: Dehydrated<ast.RosettaSynonymSource>,
    index: number,
    externalClasse: Dehydrated<ast.RosettaExternalClass>
  ): void {
    node.externalClasses[index] = externalClasse;
  }
  export function moveExternalClasseAt(node: Dehydrated<ast.RosettaSynonymSource>, from: number, to: number): void {
    if (from < 0 || from >= node.externalClasses.length) return;
    const [item] = node.externalClasses.splice(from, 1);
    if (item === undefined) return;
    node.externalClasses.splice(to, 0, item);
  }
  export function getExternalEnums(node: Dehydrated<ast.RosettaSynonymSource>): Dehydrated<ast.RosettaExternalEnum>[] {
    return node.externalEnums;
  }
  export function addExternalEnum(
    node: Dehydrated<ast.RosettaSynonymSource>,
    externalEnum: Dehydrated<ast.RosettaExternalEnum>
  ): void {
    node.externalEnums.push(externalEnum);
  }
  export function insertExternalEnumAt(
    node: Dehydrated<ast.RosettaSynonymSource>,
    index: number,
    externalEnum: Dehydrated<ast.RosettaExternalEnum>
  ): void {
    node.externalEnums.splice(index, 0, externalEnum);
  }
  export function removeExternalEnumAt(node: Dehydrated<ast.RosettaSynonymSource>, index: number): void {
    node.externalEnums.splice(index, 1);
  }
  export function setExternalEnumAt(
    node: Dehydrated<ast.RosettaSynonymSource>,
    index: number,
    externalEnum: Dehydrated<ast.RosettaExternalEnum>
  ): void {
    node.externalEnums[index] = externalEnum;
  }
  export function moveExternalEnumAt(node: Dehydrated<ast.RosettaSynonymSource>, from: number, to: number): void {
    if (from < 0 || from >= node.externalEnums.length) return;
    const [item] = node.externalEnums.splice(from, 1);
    if (item === undefined) return;
    node.externalEnums.splice(to, 0, item);
  }
}

export type RosettaTypeAlias = ast.RosettaTypeAlias;
export namespace RosettaTypeAlias {
  export function getParameters(node: Dehydrated<ast.RosettaTypeAlias>): Dehydrated<ast.TypeParameter>[] {
    return node.parameters;
  }
  export function addParameter(node: Dehydrated<ast.RosettaTypeAlias>, parameter: Dehydrated<ast.TypeParameter>): void {
    node.parameters.push(parameter);
  }
  export function insertParameterAt(
    node: Dehydrated<ast.RosettaTypeAlias>,
    index: number,
    parameter: Dehydrated<ast.TypeParameter>
  ): void {
    node.parameters.splice(index, 0, parameter);
  }
  export function removeParameterAt(node: Dehydrated<ast.RosettaTypeAlias>, index: number): void {
    node.parameters.splice(index, 1);
  }
  export function setParameterAt(
    node: Dehydrated<ast.RosettaTypeAlias>,
    index: number,
    parameter: Dehydrated<ast.TypeParameter>
  ): void {
    node.parameters[index] = parameter;
  }
  export function moveParameterAt(node: Dehydrated<ast.RosettaTypeAlias>, from: number, to: number): void {
    if (from < 0 || from >= node.parameters.length) return;
    const [item] = node.parameters.splice(from, 1);
    if (item === undefined) return;
    node.parameters.splice(to, 0, item);
  }
  export function setTypeCall(node: Dehydrated<ast.RosettaTypeAlias>, typeCall: Dehydrated<ast.TypeCall>): void {
    node.typeCall = typeCall;
  }
  export function getConditions(node: Dehydrated<ast.RosettaTypeAlias>): Dehydrated<ast.Condition>[] {
    return node.conditions;
  }
  export function addCondition(node: Dehydrated<ast.RosettaTypeAlias>, condition: Dehydrated<ast.Condition>): void {
    node.conditions.push(condition);
  }
  export function insertConditionAt(
    node: Dehydrated<ast.RosettaTypeAlias>,
    index: number,
    condition: Dehydrated<ast.Condition>
  ): void {
    node.conditions.splice(index, 0, condition);
  }
  export function removeConditionAt(node: Dehydrated<ast.RosettaTypeAlias>, index: number): void {
    node.conditions.splice(index, 1);
  }
  export function setConditionAt(
    node: Dehydrated<ast.RosettaTypeAlias>,
    index: number,
    condition: Dehydrated<ast.Condition>
  ): void {
    node.conditions[index] = condition;
  }
  export function moveConditionAt(node: Dehydrated<ast.RosettaTypeAlias>, from: number, to: number): void {
    if (from < 0 || from >= node.conditions.length) return;
    const [item] = node.conditions.splice(from, 1);
    if (item === undefined) return;
    node.conditions.splice(to, 0, item);
  }
}

export type RuleReferenceAnnotation = ast.RuleReferenceAnnotation;
export namespace RuleReferenceAnnotation {
  export function setReportingRule(node: Dehydrated<ast.RuleReferenceAnnotation>, refText: string): void {
    node.reportingRule = { $refText: refText };
  }
  export function clearReportingRule(node: Dehydrated<ast.RuleReferenceAnnotation>): void {
    node.reportingRule = undefined;
  }
}

export type Schema = ast.Schema;
export namespace Schema {
  export function setFormat(node: Dehydrated<ast.Schema>, refText: string): void {
    node.format = { $refText: refText };
  }
  export function getAnnotations(node: Dehydrated<ast.Schema>): Dehydrated<ast.AnnotationRef>[] {
    return node.annotations;
  }
  export function addAnnotation(node: Dehydrated<ast.Schema>, annotation: Dehydrated<ast.AnnotationRef>): void {
    node.annotations.push(annotation);
  }
  export function insertAnnotationAt(
    node: Dehydrated<ast.Schema>,
    index: number,
    annotation: Dehydrated<ast.AnnotationRef>
  ): void {
    node.annotations.splice(index, 0, annotation);
  }
  export function removeAnnotationAt(node: Dehydrated<ast.Schema>, index: number): void {
    node.annotations.splice(index, 1);
  }
  export function setAnnotationAt(
    node: Dehydrated<ast.Schema>,
    index: number,
    annotation: Dehydrated<ast.AnnotationRef>
  ): void {
    node.annotations[index] = annotation;
  }
  export function moveAnnotationAt(node: Dehydrated<ast.Schema>, from: number, to: number): void {
    if (from < 0 || from >= node.annotations.length) return;
    const [item] = node.annotations.splice(from, 1);
    if (item === undefined) return;
    node.annotations.splice(to, 0, item);
  }
}

export type Segment = ast.Segment;
export namespace Segment {
  export function setFeature(node: Dehydrated<ast.Segment>, refText: string): void {
    node.feature = { $refText: refText };
  }
  export function setNext(node: Dehydrated<ast.Segment>, next: Dehydrated<ast.Segment>): void {
    node.next = next;
  }
  export function clearNext(node: Dehydrated<ast.Segment>): void {
    node.next = undefined;
  }
}

export type SortOperation = ast.SortOperation;
export namespace SortOperation {
  export function setFunction(node: Dehydrated<ast.SortOperation>, function_: Dehydrated<ast.InlineFunction>): void {
    node.function = function_;
  }
  export function clearFunction(node: Dehydrated<ast.SortOperation>): void {
    node.function = undefined;
  }
}

export type SwitchCaseGuard = ast.SwitchCaseGuard;
export namespace SwitchCaseGuard {
  export function setReferenceGuard(node: Dehydrated<ast.SwitchCaseGuard>, refText: string): void {
    node.referenceGuard = { $refText: refText };
  }
  export function clearReferenceGuard(node: Dehydrated<ast.SwitchCaseGuard>): void {
    node.referenceGuard = undefined;
  }
}

export type SwitchCaseOrDefault = ast.SwitchCaseOrDefault;
export namespace SwitchCaseOrDefault {
  export function setGuard(node: Dehydrated<ast.SwitchCaseOrDefault>, guard: Dehydrated<ast.SwitchCaseGuard>): void {
    node.guard = guard;
  }
  export function clearGuard(node: Dehydrated<ast.SwitchCaseOrDefault>): void {
    node.guard = undefined;
  }
}

export type SwitchOperation = ast.SwitchOperation;
export namespace SwitchOperation {
  export function getCases(node: Dehydrated<ast.SwitchOperation>): Dehydrated<ast.SwitchCaseOrDefault>[] {
    return node.cases;
  }
  export function addCase(node: Dehydrated<ast.SwitchOperation>, case_: Dehydrated<ast.SwitchCaseOrDefault>): void {
    node.cases.push(case_);
  }
  export function insertCaseAt(
    node: Dehydrated<ast.SwitchOperation>,
    index: number,
    case_: Dehydrated<ast.SwitchCaseOrDefault>
  ): void {
    node.cases.splice(index, 0, case_);
  }
  export function removeCaseAt(node: Dehydrated<ast.SwitchOperation>, index: number): void {
    node.cases.splice(index, 1);
  }
  export function setCaseAt(
    node: Dehydrated<ast.SwitchOperation>,
    index: number,
    case_: Dehydrated<ast.SwitchCaseOrDefault>
  ): void {
    node.cases[index] = case_;
  }
  export function moveCaseAt(node: Dehydrated<ast.SwitchOperation>, from: number, to: number): void {
    if (from < 0 || from >= node.cases.length) return;
    const [item] = node.cases.splice(from, 1);
    if (item === undefined) return;
    node.cases.splice(to, 0, item);
  }
}

export type ThenOperation = ast.ThenOperation;
export namespace ThenOperation {
  export function setFunction(node: Dehydrated<ast.ThenOperation>, function_: Dehydrated<ast.InlineFunction>): void {
    node.function = function_;
  }
  export function clearFunction(node: Dehydrated<ast.ThenOperation>): void {
    node.function = undefined;
  }
}

export type ToEnumOperation = ast.ToEnumOperation;
export namespace ToEnumOperation {
  export function setEnumeration(node: Dehydrated<ast.ToEnumOperation>, refText: string): void {
    node.enumeration = { $refText: refText };
  }
}

export type TypeCall = ast.TypeCall;
export namespace TypeCall {
  export function setType(node: Dehydrated<ast.TypeCall>, refText: string): void {
    node.type = { $refText: refText };
  }
  export function getArguments(node: Dehydrated<ast.TypeCall>): Dehydrated<ast.TypeCallArgument>[] {
    return node.arguments;
  }
  export function addArgument(node: Dehydrated<ast.TypeCall>, argument: Dehydrated<ast.TypeCallArgument>): void {
    node.arguments.push(argument);
  }
  export function insertArgumentAt(
    node: Dehydrated<ast.TypeCall>,
    index: number,
    argument: Dehydrated<ast.TypeCallArgument>
  ): void {
    node.arguments.splice(index, 0, argument);
  }
  export function removeArgumentAt(node: Dehydrated<ast.TypeCall>, index: number): void {
    node.arguments.splice(index, 1);
  }
  export function setArgumentAt(
    node: Dehydrated<ast.TypeCall>,
    index: number,
    argument: Dehydrated<ast.TypeCallArgument>
  ): void {
    node.arguments[index] = argument;
  }
  export function moveArgumentAt(node: Dehydrated<ast.TypeCall>, from: number, to: number): void {
    if (from < 0 || from >= node.arguments.length) return;
    const [item] = node.arguments.splice(from, 1);
    if (item === undefined) return;
    node.arguments.splice(to, 0, item);
  }
}

export type TypeCallArgument = ast.TypeCallArgument;
export namespace TypeCallArgument {
  export function setParameter(node: Dehydrated<ast.TypeCallArgument>, refText: string): void {
    node.parameter = { $refText: refText };
  }
}

export type TypeParameter = ast.TypeParameter;
export namespace TypeParameter {
  export function setTypeCall(node: Dehydrated<ast.TypeParameter>, typeCall: Dehydrated<ast.TypeCall>): void {
    node.typeCall = typeCall;
  }
}

export type WithMetaEntry = ast.WithMetaEntry;
export namespace WithMetaEntry {
  export function setKey(node: Dehydrated<ast.WithMetaEntry>, refText: string): void {
    node.key = { $refText: refText };
  }
}

export type WithMetaOperation = ast.WithMetaOperation;
export namespace WithMetaOperation {
  export function getEntries(node: Dehydrated<ast.WithMetaOperation>): Dehydrated<ast.WithMetaEntry>[] {
    return node.entries;
  }
  export function addEntrie(node: Dehydrated<ast.WithMetaOperation>, entrie: Dehydrated<ast.WithMetaEntry>): void {
    node.entries.push(entrie);
  }
  export function insertEntrieAt(
    node: Dehydrated<ast.WithMetaOperation>,
    index: number,
    entrie: Dehydrated<ast.WithMetaEntry>
  ): void {
    node.entries.splice(index, 0, entrie);
  }
  export function removeEntrieAt(node: Dehydrated<ast.WithMetaOperation>, index: number): void {
    node.entries.splice(index, 1);
  }
  export function setEntrieAt(
    node: Dehydrated<ast.WithMetaOperation>,
    index: number,
    entrie: Dehydrated<ast.WithMetaEntry>
  ): void {
    node.entries[index] = entrie;
  }
  export function moveEntrieAt(node: Dehydrated<ast.WithMetaOperation>, from: number, to: number): void {
    if (from < 0 || from >= node.entries.length) return;
    const [item] = node.entries.splice(from, 1);
    if (item === undefined) return;
    node.entries.splice(to, 0, item);
  }
}

export class DuplicateKeyError extends Error {
  constructor(public readonly key: string) {
    super(`Duplicate repository key: ${key}`);
    this.name = 'DuplicateKeyError';
  }
}

export interface Repository<T> {
  byId(id: string): T | undefined;
  byType<K extends string>(type: K): readonly T[];
  all(): readonly T[];
}

export function createRepository<T>(
  items: Iterable<T>,
  opts: { key: (t: T) => string; type: (t: T) => string }
): Repository<T> {
  const byIdMap = new Map<string, T>();
  const byTypeMap = new Map<string, T[]>();
  const allItems: T[] = [];
  for (const item of items) {
    const k = opts.key(item);
    if (byIdMap.has(k)) throw new DuplicateKeyError(k);
    byIdMap.set(k, item);
    const t = opts.type(item);
    let bucket = byTypeMap.get(t);
    if (bucket === undefined) {
      bucket = [];
      byTypeMap.set(t, bucket);
    }
    bucket.push(item);
    allItems.push(item);
  }
  return {
    byId: (id) => byIdMap.get(id),
    byType: <K extends string>(type: K) => (byTypeMap.get(type) ?? []) as readonly T[],
    all: () => allItems
  };
}

export type AnyDomain =
  | Dehydrated<ast.Data>
  | Dehydrated<ast.Choice>
  | Dehydrated<ast.RosettaEnumeration>
  | Dehydrated<ast.RosettaFunction>
  | Dehydrated<ast.RosettaRecordType>
  | Dehydrated<ast.RosettaTypeAlias>
  | Dehydrated<ast.RosettaBasicType>
  | Dehydrated<ast.Annotation>;

export interface DomainRepository {
  byId(qn: string): AnyDomain | undefined;
  byType<K extends AnyDomain['$type']>(type: K): readonly Extract<AnyDomain, { $type: K }>[];
  all(): readonly AnyDomain[];
}

export function createDomainRepository(
  elements: Iterable<AnyDomain>,
  key: (e: AnyDomain) => string = (e) => (e.$namespace ? `${e.$namespace}.${e.name}` : e.name)
): DomainRepository {
  return createRepository(elements, { key, type: (e) => e.$type }) as DomainRepository;
}
