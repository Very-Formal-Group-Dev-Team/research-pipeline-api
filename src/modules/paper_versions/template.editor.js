const path = require('path');
const fs = require('fs/promises');
const JSZip = require('jszip');
require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

const TEMPLATE_DIR = path.join(__dirname, 'templates');
const TEMPLATE_FILES = {
  imrad: 'IMRAD Template.docx',
  ieee: 'IEEE Template.docx',
};

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

function normalizeStandard(paperStandard) {
  return String(paperStandard || 'ieee').trim().toLowerCase();
}

async function loadTemplate(paperStandard) {
  const standard = normalizeStandard(paperStandard);
  const fileName = standard === 'imrad' ? TEMPLATE_FILES.imrad : TEMPLATE_FILES.ieee;
  const templatePath = path.join(TEMPLATE_DIR, fileName);
  return fs.readFile(templatePath);
}

function formatProjectData(project, members, institution) {
  const memberNames = members.map((m) => m.full_name).filter(Boolean);
  const adviser = members.find((m) => m.role === 'adviser');

  return {
    research_title: project.title || 'Research Project',
    researcher_names: memberNames,
    program_name: project.program || 'Research Program',
    college_name: institution?.name || 'College of Computing',
    school_name: institution?.name || 'Institution Name',
    adviser_name: adviser?.full_name || null,
  };
}

async function generateMappingWithAI(projectData, paperStandard) {
  if (!process.env.GEMINI_API_KEY) {
    console.warn('GEMINI_API_KEY not set, using default placeholder replacement');
    return buildDefaultReplacements(projectData, paperStandard);
  }

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const prompt = `You are filling in a research paper template. Match and replace ONLY these specific placeholders with the provided data. 

**IMPORTANT**: Only return exact replacements for these 6 fields. Do NOT create new fields or generic content.

Template placeholders to find and replace:
1. [Research Title] → ${projectData.research_title}
2. [Researcher Name] → Each occurrence should be replaced with one researcher name in order: ${projectData.researcher_names.join(', ')}
3. [Program Name (ex:Bachelor...)] or [Program Name] → ${projectData.program_name}
4. [College Name (ex: College of...)] → ${projectData.college_name}
5. [School Name] → ${projectData.school_name}
6. [Adviser Name] or similar → ${projectData.adviser_name || '[Adviser Name]'}

Return a JSON object with replacements. For [Researcher Name] that appears multiple times, include separate entries for each occurrence.

Example format:
{
  "replacements": [
    {"original": "[Research Title]", "replacement": "My Research Title"},
    {"original": "[Researcher Name]", "replacement": "John Doe"},
    {"original": "[Researcher Name]", "replacement": "Jane Smith"},
    ...
  ]
}

Return ONLY the JSON object, no other text.`;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();

    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn('No JSON in Gemini response, using defaults');
      return buildDefaultReplacements(projectData, paperStandard);
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      replacements: (parsed.replacements || []).map((r) => ({
        original: r.original || r.original_text,
        replacement: r.replacement || r.replacement_text,
      })),
    };
  } catch (error) {
    console.warn('Gemini API failed, using default replacements:', error.message);
    return buildDefaultReplacements(projectData, paperStandard);
  }
}

function buildDefaultReplacements(projectData, paperStandard) {
  const replacements = [];

  replacements.push({
    original: '[Research Title]',
    replacement: projectData.research_title,
  });

  projectData.researcher_names.forEach((name) => {
    replacements.push({
      original: '[Researcher Name]',
      replacement: name,
    });
  });

  replacements.push({
    original: '[Program Name (ex:Bachelor of science in computer science)]',
    replacement: projectData.program_name,
  });

  replacements.push({
    original: '[Program Name]',
    replacement: projectData.program_name,
  });

  replacements.push({
    original: '[College Name (ex: College of Computer and Information Science)]',
    replacement: projectData.college_name,
  });

  replacements.push({
    original: '[School Name]',
    replacement: projectData.school_name,
  });

  if (projectData.adviser_name) {
    replacements.push({
      original: '[Adviser Name]',
      replacement: projectData.adviser_name,
    });
  }

  return { replacements };
}

async function applyReplacementsToDocx(docxBuffer, replacements) {
  const zip = await JSZip.loadAsync(docxBuffer);
  const xmlEntries = Object.keys(zip.files).filter((fileName) => fileName.endsWith('.xml'));

  for (const fileName of xmlEntries) {
    let xml = await zip.file(fileName).async('string');

    for (const replacement of replacements) {
      let { original, replacement: newText } = replacement;

      const escapedNewText = escapeXmlForWord(newText);

      if (original.includes('[Program Name (')) {
        const complexRegex = /\[Program Name \([^)]*\)/g;
        xml = xml.replace(complexRegex, escapedNewText);
      } else if (original.includes('[College Name (')) {
        const complexRegex = /\[College Name \([^\]]*\)/g;
        xml = xml.replace(complexRegex, escapedNewText);
      } else if (original.includes('[') && original.includes('(')) {
        const start = original.substring(0, original.indexOf('(') + 1);
        const complexRegex = new RegExp(
          escapeRegex(start) + '[\\s\\S]*?\\)',
          'g',
        );
        xml = xml.replace(complexRegex, escapedNewText);
      } else {
        const simpleRegex = new RegExp(escapeRegex(original), 'g');
        xml = xml.replace(simpleRegex, escapedNewText);
      }
    }

    zip.file(fileName, xml);
  }

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeXmlForWord(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function editTemplate(input) {
  const project = typeof input === 'string'
    ? { paper_standard: input, title: 'Research Project' }
    : (input || {});

  const projectData = formatProjectData(project.project || project, project.members || [], project.institution || null);

  const templateBuffer = await loadTemplate(project.paper_standard || 'ieee');

  const mapping = await generateMappingWithAI(projectData, project.paper_standard || 'ieee');

  const updatedBuffer = await applyReplacementsToDocx(templateBuffer, mapping.replacements || []);

  return updatedBuffer;
}

module.exports = { editTemplate };
