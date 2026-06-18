const { randomUUID } = require('crypto');
const Diff = require('diff');
const db = require('../../../config/db');
const { getVersionAncestry } = require('./paper_versions.service');
const { getBranch } = require('./paper_branches.service');

// ─── Paragraph utilities ──────────────────────────────────────────────────────

function splitParagraphs(text) {
  if (!text) return [];
  return text
    .split(/\n\n+/)
    .map(p => p.trim())
    .filter(p => p.length > 0);
}

// ─── Diff annotation ──────────────────────────────────────────────────────────

/**
 * Converts a diffArrays result (ancestor → target) into per-ancestor-position
 * annotations used by threeWayMerge.
 *
 * ops[i] is one of:
 *   'keep'                            – paragraph unchanged
 *   'delete'                          – paragraph removed
 *   { type: 'replace', paras: [] }    – replaced; for a group removal the replacement
 *                                       paras are recorded at the first removed position,
 *                                       subsequent removed positions get 'delete'
 *
 * insertsBefore[i] – paragraphs prepended before ancestor position i
 * insertsAfter     – paragraphs appended after the last ancestor paragraph
 */
function buildAnnotations(ancestorParas, changes) {
  const ops = new Array(ancestorParas.length).fill('keep');
  const insertsBefore = Array.from({ length: ancestorParas.length }, () => []);
  const insertsAfter = [];
  let idx = 0;

  for (let ci = 0; ci < changes.length; ci++) {
    const change = changes[ci];

    if (!change.added && !change.removed) {
      idx += change.value.length;
      continue;
    }

    if (change.removed) {
      const removedCount = change.value.length;
      const next = changes[ci + 1];

      if (next && next.added) {
        ops[idx] = { type: 'replace', paras: next.value };
        for (let j = 1; j < removedCount; j++) ops[idx + j] = 'delete';
        ci++;
      } else {
        for (let j = 0; j < removedCount; j++) ops[idx + j] = 'delete';
      }
      idx += removedCount;
      continue;
    }

    if (change.added) {
      if (idx < ancestorParas.length) {
        insertsBefore[idx].push(...change.value);
      } else {
        insertsAfter.push(...change.value);
      }
    }
  }

  return { ops, insertsBefore, insertsAfter };
}

// ─── Three-way merge ──────────────────────────────────────────────────────────

/**
 * Merge ancestorText → aText and ancestorText → bText at paragraph granularity
 * (paragraphs = blocks separated by blank lines).
 *
 * Decision table for each ancestor position:
 *   both kept unchanged          → status: 'unchanged'
 *   only A changed               → take A's output (deletion = no entry emitted)
 *   only B changed               → take B's output (deletion = no entry emitted)
 *   both deleted                 → nothing emitted (agreement)
 *   both changed identically     → status: 'unchanged' (auto-resolved)
 *   both changed differently     → status: 'conflict'
 *   one deleted, other modified  → status: 'conflict' (conflictA/B = '' for the deletion)
 *
 * Concurrent pure insertions at the same position are appended A-first then B
 * with their respective 'fromA'/'fromB' status labels.
 *
 * Returns { mergedParagraphs, hasConflicts }.
 * Each entry: { status: 'unchanged'|'fromA'|'fromB'|'conflict',
 *               content?: string, conflictA?: string, conflictB?: string }
 */
function threeWayMerge(ancestorText, aText, bText) {
  const ap = splitParagraphs(ancestorText || '');
  const aParasFull = splitParagraphs(aText || '');
  const bParasFull = splitParagraphs(bText || '');

  const changesA = Diff.diffArrays(ap, aParasFull);
  const changesB = Diff.diffArrays(ap, bParasFull);

  const annA = buildAnnotations(ap, changesA);
  const annB = buildAnnotations(ap, changesB);

  const mergedParagraphs = [];
  let hasConflicts = false;

  for (let i = 0; i < ap.length; i++) {
    for (const p of annA.insertsBefore[i]) mergedParagraphs.push({ status: 'fromA', content: p });
    for (const p of annB.insertsBefore[i]) mergedParagraphs.push({ status: 'fromB', content: p });

    const aOp = annA.ops[i];
    const bOp = annB.ops[i];

    const aChanged = aOp !== 'keep';
    const bChanged = bOp !== 'keep';

    const aResult = aOp === 'keep' ? [ap[i]] : aOp === 'delete' ? [] : aOp.paras;
    const bResult = bOp === 'keep' ? [ap[i]] : bOp === 'delete' ? [] : bOp.paras;

    if (!aChanged && !bChanged) {
      mergedParagraphs.push({ status: 'unchanged', content: ap[i] });
    } else if (!aChanged) {
      for (const p of bResult) mergedParagraphs.push({ status: 'fromB', content: p });
    } else if (!bChanged) {
      for (const p of aResult) mergedParagraphs.push({ status: 'fromA', content: p });
    } else {
      const aStr = aResult.join('\n\n');
      const bStr = bResult.join('\n\n');
      if (aStr === bStr) {
        for (const p of aResult) mergedParagraphs.push({ status: 'unchanged', content: p });
      } else {
        hasConflicts = true;
        mergedParagraphs.push({ status: 'conflict', conflictA: aStr, conflictB: bStr });
      }
    }
  }

  for (const p of annA.insertsAfter) mergedParagraphs.push({ status: 'fromA', content: p });
  for (const p of annB.insertsAfter) mergedParagraphs.push({ status: 'fromB', content: p });

  return { mergedParagraphs, hasConflicts };
}

// ─── Common ancestor ──────────────────────────────────────────────────────────

/**
 * Walk parent_version_id chains for both versions and return the most recent
 * shared ancestor (first entry in B's ancestry found in A's ancestry set).
 *
 * isFastForward is true when the common ancestor IS one of the two heads:
 *   ancestor.id === versionIdA → A is an ancestor of B (B is ahead)
 *   ancestor.id === versionIdB → B is an ancestor of A (A is ahead)
 *
 * In either fast-forward case no three-way merge is needed.
 *
 * Returns { ancestor: row | null, isFastForward: boolean }.
 */
async function findCommonAncestor(versionIdA, versionIdB) {
  const [ancestryA, ancestryB] = await Promise.all([
    getVersionAncestry(versionIdA),
    getVersionAncestry(versionIdB),
  ]);

  const setA = new Set(ancestryA.map(v => v.id));

  for (const v of ancestryB) {
    if (setA.has(v.id)) {
      const isFastForward = v.id === versionIdA || v.id === versionIdB;
      return { ancestor: v, isFastForward };
    }
  }

  return { ancestor: null, isFastForward: false };
}

// ─── Private DB helpers ───────────────────────────────────────────────────────

async function getVersionById(versionId) {
  const { rows } = await db.query(
    `SELECT id, project_id, branch_id, content_text,
            file_url, file_name, file_size, mime_type
     FROM paper_versions WHERE id = ? LIMIT 1`,
    [versionId],
  );
  return rows[0] || null;
}

async function touchProjectUpdatedAt(projectId) {
  await db.query('UPDATE projects SET updated_at = NOW() WHERE id = ?', [projectId]);
}

// ─── mergeBranches ────────────────────────────────────────────────────────────

/**
 * Three-way merge of sourceBranch into targetBranch.
 *
 * Parameters
 *   projectId        – project scope
 *   sourceBranchName – branch being merged in
 *   targetBranchName – branch being merged into (receives the new commit)
 *   uploadedBy       – user ID recorded on the merge commit
 *   resolutions      – optional Array<'A' | 'B' | string>, one entry per conflict
 *                      paragraph in the order they appear in mergedParagraphs;
 *                      'A' takes conflictA, 'B' takes conflictB, any other string
 *                      becomes the resolved text
 *
 * Return shapes
 *   { type: 'already-merged' }
 *     Source head is in target's ancestry — nothing to do.
 *
 *   { type: 'fast-forward', sourceHeadId }
 *     Target head is a direct ancestor of source; no divergence, no merge commit
 *     created. Caller may choose to update the target branch head externally.
 *
 *   { type: 'conflict', paragraphs, ancestorVersionId, sourceVersionId, targetVersionId }
 *     Unresolved conflicts — no commit written. Re-call with resolutions[] to commit.
 *
 *   { type: 'merged', versionId, versionNumber }
 *     Merge commit written to targetBranch.
 *
 * File URL on merge commits
 *   The target head's file_url is reused. Merge commits carry no uploaded file of
 *   their own; pointing at the most recent real file on the target branch gives the
 *   download endpoint a valid path to serve while the canonical merged text lives in
 *   content_text. An alternative (generating a .docx from the merged text) is left
 *   for a future pass.
 */
async function mergeBranches(projectId, sourceBranchName, targetBranchName, uploadedBy, resolutions, { dryRun = false } = {}) {
  const [sourceBranch, targetBranch] = await Promise.all([
    getBranch(projectId, sourceBranchName),
    getBranch(projectId, targetBranchName),
  ]);

  if (!sourceBranch) {
    const err = new Error(`Branch "${sourceBranchName}" not found`); err.status = 404; throw err;
  }
  if (!targetBranch) {
    const err = new Error(`Branch "${targetBranchName}" not found`); err.status = 404; throw err;
  }
  if (sourceBranch.id === targetBranch.id) {
    const err = new Error('Cannot merge a branch into itself'); err.status = 400; throw err;
  }

  const sourceHeadId = sourceBranch.head_version_id;
  const targetHeadId = targetBranch.head_version_id;

  if (!sourceHeadId) {
    const err = new Error(`Branch "${sourceBranchName}" has no commits`); err.status = 400; throw err;
  }
  if (!targetHeadId) {
    const err = new Error(`Branch "${targetBranchName}" has no commits`); err.status = 400; throw err;
  }

  // ── Common ancestor ──────────────────────────────────────────────────────
  const { ancestor, isFastForward } = await findCommonAncestor(sourceHeadId, targetHeadId);

  if (!ancestor) {
    const err = new Error('Branches share no common ancestor — cannot merge unrelated histories');
    err.status = 409; throw err;
  }

  if (isFastForward && ancestor.id === sourceHeadId) {
    return { type: 'already-merged' };
  }
  if (isFastForward && ancestor.id === targetHeadId) {
    return { type: 'fast-forward', sourceHeadId };
  }

  // ── Fetch content ────────────────────────────────────────────────────────
  const [ancestorVersion, sourceVersion, targetVersion] = await Promise.all([
    getVersionById(ancestor.id),
    getVersionById(sourceHeadId),
    getVersionById(targetHeadId),
  ]);

  // A = target (parent of merge commit), B = source (incoming changes)
  const mergeResult = threeWayMerge(
    ancestorVersion?.content_text || '',
    targetVersion.content_text || '',
    sourceVersion.content_text || '',
  );

  // ── Early return on unresolved conflicts ─────────────────────────────────
  if (mergeResult.hasConflicts && !resolutions) {
    return {
      type: 'conflict',
      paragraphs: mergeResult.mergedParagraphs,
      ancestorVersionId: ancestor.id,
      sourceVersionId: sourceHeadId,
      targetVersionId: targetHeadId,
    };
  }

  // ── Apply resolutions ────────────────────────────────────────────────────
  let finalParagraphs = mergeResult.mergedParagraphs;
  if (resolutions && mergeResult.hasConflicts) {
    let conflictIdx = 0;
    finalParagraphs = mergeResult.mergedParagraphs.map(p => {
      if (p.status !== 'conflict') return p;
      const choice = resolutions[conflictIdx++];
      if (choice === 'A') return { status: 'fromA', content: p.conflictA };
      if (choice === 'B') return { status: 'fromB', content: p.conflictB };
      if (typeof choice === 'string' && choice !== '') return { status: 'fromA', content: choice };
      return p;
    });
  }

  if (finalParagraphs.some(p => p.status === 'conflict')) {
    return {
      type: 'conflict',
      paragraphs: mergeResult.mergedParagraphs,
      ancestorVersionId: ancestor.id,
      sourceVersionId: sourceHeadId,
      targetVersionId: targetHeadId,
    };
  }

  // ── Build merged text ────────────────────────────────────────────────────
  const mergedText = finalParagraphs
    .filter(p => p.content != null && p.content !== '')
    .map(p => p.content)
    .join('\n\n');

  if (dryRun) {
    return { type: 'clean', paragraphs: finalParagraphs };
  }

  // ── Commit ───────────────────────────────────────────────────────────────
  const newVersionId = randomUUID();
  let versionNumber;

  const conn = await db.pool.getConnection();
  try {
    await conn.beginTransaction();

    const [branchRows] = await conn.execute(
      'SELECT id FROM branches WHERE id = ? LIMIT 1 FOR UPDATE',
      [targetBranch.id],
    );
    if (!branchRows[0]) throw new Error('Target branch disappeared during merge commit');

    const [countRows] = await conn.execute(
      'SELECT COALESCE(MAX(version_number), 0) AS max_v FROM paper_versions WHERE branch_id = ?',
      [targetBranch.id],
    );
    versionNumber = (countRows[0]?.max_v ?? 0) + 1;

    await conn.execute(
      `INSERT INTO paper_versions
         (id, project_id, version_number, file_url, file_name, file_size, mime_type,
          commit_message, tag, uploaded_by, is_generated,
          branch_id, parent_version_id, merge_parent_version_id, content_text)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        newVersionId,
        projectId,
        versionNumber,
        targetVersion.file_url,
        targetVersion.file_name,
        targetVersion.file_size,
        targetVersion.mime_type || null,
        `Merge branch "${sourceBranchName}" into ${targetBranchName}`,
        'merge',
        uploadedBy,
        0,
        targetBranch.id,
        targetHeadId,
        sourceHeadId,
        mergedText,
      ],
    );

    await conn.execute(
      'UPDATE branches SET head_version_id = ? WHERE id = ?',
      [newVersionId, targetBranch.id],
    );

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  await touchProjectUpdatedAt(projectId);

  return { type: 'merged', versionId: newVersionId, versionNumber };
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = { findCommonAncestor, splitParagraphs, threeWayMerge, mergeBranches };

// ─── Example calls (run file directly: node paper_merge.service.js) ───────────

if (require.main === module) {
  // Example 1 — clean auto-merge: A and B edited different paragraphs
  const ex1Ancestor = [
    'Introduction',
    'This study examines the impact of climate change on coastal ecosystems.',
    'Background',
    'Prior work has established baseline metrics for sea temperature and acidity.',
  ].join('\n\n');

  const ex1A = [
    'Introduction',
    'This study rigorously examines the impact of climate change on coastal ecosystems using satellite data.',
    'Background',
    'Prior work has established baseline metrics for sea temperature and acidity.',
  ].join('\n\n');

  const ex1B = [
    'Introduction',
    'This study examines the impact of climate change on coastal ecosystems.',
    'Background',
    'Prior work has established baseline metrics for sea temperature, acidity, and salinity levels.',
  ].join('\n\n');

  const clean = threeWayMerge(ex1Ancestor, ex1A, ex1B);
  console.log('=== Example 1: clean auto-merge ===');
  console.log('hasConflicts:', clean.hasConflicts);
  clean.mergedParagraphs.forEach((p, i) =>
    console.log(`  [${i}] ${p.status}: ${(p.content ?? '').slice(0, 70)}`),
  );

  // Example 2 — real conflict: both branches rewrote the same paragraph differently
  const ex2Ancestor = [
    'Abstract',
    'We propose a lightweight algorithm for real-time text summarisation.',
    'Conclusion',
    'Results confirm the approach outperforms existing baselines.',
  ].join('\n\n');

  const ex2A = [
    'Abstract',
    'We propose a lightweight transformer-based algorithm for real-time text summarisation.',
    'Conclusion',
    'Results confirm the approach outperforms existing baselines.',
  ].join('\n\n');

  const ex2B = [
    'Abstract',
    'We propose a lightweight recurrent-network algorithm for real-time text summarisation.',
    'Conclusion',
    'Results confirm the approach outperforms existing baselines.',
  ].join('\n\n');

  const conflict = threeWayMerge(ex2Ancestor, ex2A, ex2B);
  console.log('\n=== Example 2: conflict ===');
  console.log('hasConflicts:', conflict.hasConflicts);
  conflict.mergedParagraphs.forEach((p, i) => {
    if (p.status === 'conflict') {
      console.log(`  [${i}] CONFLICT`);
      console.log(`       A: ${p.conflictA.slice(0, 70)}`);
      console.log(`       B: ${p.conflictB.slice(0, 70)}`);
    } else {
      console.log(`  [${i}] ${p.status}: ${(p.content ?? '').slice(0, 70)}`);
    }
  });

  // Example 3 — fast-forward detection (requires DB; shown as a pattern)
  console.log('\n=== Example 3: fast-forward (async, needs real version IDs) ===');
  console.log('  const { ancestor, isFastForward } = await findCommonAncestor(featureHeadId, mainHeadId);');
  console.log('  // isFastForward === true when one head is a direct ancestor of the other.');
  console.log('  // mergeBranches returns { type: "fast-forward" } — no merge commit is written.');
  console.log('  // mergeBranches returns { type: "already-merged" } when source <= target ancestry.');
}
