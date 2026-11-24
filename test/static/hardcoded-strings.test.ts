import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const WEB_ROOT = "src/app/web";
const TEXT_ATTRIBUTES = new Set(["placeholder", "title", "alt", "aria-label", "label"]);
const LETTERS = /\p{L}{2,}/u;

export function listSourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      return listSourceFiles(path);
    }
    return path.endsWith(".tsx") ? [path] : [];
  });
}

function isTextLiteral(node: ts.Node): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | ts.TemplateExpression {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node);
}

function literalText(node: ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | ts.TemplateExpression): string {
  if (ts.isTemplateExpression(node)) {
    return [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(" ");
  }
  return node.text;
}

/** Collects literals inside an expression, ignoring anything passed to a function call such as t("key"). */
function collectExpressionLiterals(node: ts.Node, found: string[]): void {
  if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
    return;
  }
  if (ts.isCallExpression(node)) {
    return;
  }
  if (isTextLiteral(node) && LETTERS.test(literalText(node))) {
    found.push(literalText(node).trim());
    return;
  }
  ts.forEachChild(node, (child) => collectExpressionLiterals(child, found));
}

export function findHardcodedText(fileName: string, sourceText: string): string[] {
  const source = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node) && LETTERS.test(node.text)) {
      found.push(`${fileName}: text "${node.text.trim()}"`);
    }
    if (ts.isJsxAttribute(node) && node.initializer !== undefined) {
      const name = node.name.getText(source);
      if (TEXT_ATTRIBUTES.has(name)) {
        const literals: string[] = [];
        collectExpressionLiterals(node.initializer, literals);
        literals.forEach((text) => found.push(`${fileName}: attribute ${name}="${text}"`));
      }
      return;
    }
    if (ts.isJsxExpression(node) && node.expression !== undefined) {
      const literals: string[] = [];
      collectExpressionLiterals(node.expression, literals);
      literals.forEach((text) => found.push(`${fileName}: text "${text}"`));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe("user-facing strings", () => {
  it("detects literal JSX text and text attributes", () => {
    const sample = 'export const X = () => <p title="Bad title">Bad text {t("ok")}</p>;';
    expect(findHardcodedText("sample.tsx", sample)).toEqual([
      'sample.tsx: attribute title="Bad title"',
      'sample.tsx: text "Bad text"',
    ]);
  });

  it("detects literals hidden in expressions", () => {
    const sample = 'export const X = () => <p title={"Bad title"}>{"Bad text"}{ok ? `Yes ${n}` : "No way"}</p>;';
    expect(findHardcodedText("sample.tsx", sample)).toEqual([
      'sample.tsx: attribute title="Bad title"',
      'sample.tsx: text "Bad text"',
      'sample.tsx: text "Yes"',
      'sample.tsx: text "No way"',
    ]);
  });

  it("detects literals in nested elements inside expressions", () => {
    const sample = 'export const X = () => <ul>{items.map((i) => <li key={i.id}>Bad item</li>)}</ul>;';
    expect(findHardcodedText("sample.tsx", sample)).toEqual(['sample.tsx: text "Bad item"']);
  });

  it("accepts text that comes from the translator", () => {
    const sample = 'export const X = () => <p title={t("a")}>{t("b")}</p>;';
    expect(findHardcodedText("sample.tsx", sample)).toEqual([]);
  });

  it("finds no hardcoded text in src/app/web", () => {
    const files = listSourceFiles(WEB_ROOT);
    expect(files.length).toBeGreaterThan(0);
    const found = files.flatMap((file) => findHardcodedText(file, readFileSync(file, "utf8")));
    expect(found).toEqual([]);
  });
});
