/**
 * Document input: either the text itself, or a path under an allowed root (design D7).
 *
 * A path lets the model point at a long document instead of retyping it as a tool
 * argument. It is resolved with realpath (no ../ or symlink tricks), must lie under one
 * of the configured roots, must have an allowed extension and may not exceed the size
 * limit. MCP Roots would be the protocol way to do this, but they are deprecated in
 * 2026-07-28; the specification recommends server configuration instead.
 */
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, extname, isAbsolute, resolve, sep } from 'node:path';
import { LIMITS } from './config.ts';
import { DomainError } from './errors.ts';

export type DocumentInput = { text: string } | { path: string };

export interface LoadedDocument {
  text: string;
  /** "text" or the file name (never the full path: it may reveal local folders). */
  source: string;
}

function readAllowedFile(path: string, roots: string[]): LoadedDocument {
  const existingRoots = roots.filter((r) => existsSync(r)).map((r) => realpathSync(r));
  const rootList = roots.join(', ') || 'none configured';
  if (existingRoots.length === 0) {
    throw new DomainError(
      'path_not_allowed',
      'No allowed document folder exists, so paths cannot be read.',
      `Pass the document as text instead, or configure COURSE_STANDARDS_DOCS (now: ${rootList}).`,
    );
  }
  // A relative path is read relative to the first allowed root.
  const candidate = isAbsolute(path) ? path : resolve(existingRoots[0] ?? '.', path);
  if (!existsSync(candidate)) {
    throw new DomainError(
      'file_not_found',
      `The file "${basename(path)}" does not exist.`,
      `Check the path. Relative paths are read from ${existingRoots[0]}.`,
    );
  }
  const real = realpathSync(candidate);
  if (!existingRoots.some((root) => real === root || real.startsWith(root + sep))) {
    throw new DomainError(
      'path_not_allowed',
      `The file "${basename(path)}" is outside the allowed document folders.`,
      `Allowed folders: ${rootList}. Pass the text instead, or ask the user to add the folder to COURSE_STANDARDS_DOCS.`,
    );
  }
  const extension = extname(real).toLowerCase();
  if (!(LIMITS.documentExtensions as readonly string[]).includes(extension)) {
    throw new DomainError(
      'path_not_allowed',
      `Files of type "${extension || 'none'}" are not read.`,
      `Allowed: ${LIMITS.documentExtensions.join(', ')}. Convert the document (for example an Excel mapping to CSV) first.`,
    );
  }
  if (statSync(real).size > LIMITS.documentBytes) {
    throw new DomainError(
      'document_too_large',
      `The file "${basename(path)}" is larger than ${LIMITS.documentBytes / 1000} KB.`,
      'Split the document, or check one part at a time.',
    );
  }
  return { text: readFileSync(real, 'utf8'), source: basename(real) };
}

export function loadDocument(input: DocumentInput, roots: string[]): LoadedDocument {
  const doc =
    'path' in input ? readAllowedFile(input.path, roots) : { text: input.text, source: 'text' };
  if (Buffer.byteLength(doc.text, 'utf8') > LIMITS.documentBytes) {
    throw new DomainError(
      'document_too_large',
      `The document is larger than ${LIMITS.documentBytes / 1000} KB.`,
      'Split the document, or check one part at a time.',
    );
  }
  if (doc.text.trim() === '') {
    throw new DomainError(
      'empty_document',
      'The document is empty.',
      'Pass the text of the course material, or a path to a non-empty file.',
    );
  }
  return doc;
}
