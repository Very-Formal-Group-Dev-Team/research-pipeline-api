/**
 * Generates a .docx starter template based on paper standard (imrad / ieee).
 * Returns a Buffer containing the document bytes.
 */
const {
  Document,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  PageBreak,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  Packer,
} = require('docx');

/**
 * Build an IMRAD-structured document template.
 * IMRAD = Introduction, Methods, Results And Discussion
 */
function buildImradTemplate(title) {
  const heading = (text, level = HeadingLevel.HEADING_1) =>
    new Paragraph({
      text,
      heading: level,
      spacing: { before: 320, after: 120 },
    });

  const body = (text) =>
    new Paragraph({
      children: [new TextRun({ text, size: 24 })],
      spacing: { after: 200 },
    });

  const placeholder = (text) =>
    new Paragraph({
      children: [new TextRun({ text: `[${text}]`, size: 24, italics: true, color: '888888' })],
      spacing: { after: 200 },
    });

  return new Document({
    styles: {
      default: {
        document: {
          run: { font: 'Times New Roman', size: 24 },
        },
      },
    },
    sections: [
      {
        children: [
          // Title
          new Paragraph({
            children: [new TextRun({ text: title, bold: true, size: 36 })],
            alignment: AlignmentType.CENTER,
            spacing: { after: 240 },
          }),

          // Authors placeholder
          new Paragraph({
            children: [
              new TextRun({
                text: '[Author 1], [Author 2], [Author 3]',
                italics: true,
                size: 24,
                color: '888888',
              }),
            ],
            alignment: AlignmentType.CENTER,
            spacing: { after: 480 },
          }),

          // Abstract
          heading('Abstract', HeadingLevel.HEADING_1),
          placeholder('Write a 150–250 word summary of your study: background, objective, methods, key results, and conclusion.'),

          // Keywords
          new Paragraph({
            children: [
              new TextRun({ text: 'Keywords: ', bold: true, size: 24 }),
              new TextRun({ text: '[keyword1, keyword2, keyword3]', italics: true, size: 24, color: '888888' }),
            ],
            spacing: { after: 400 },
          }),

          new Paragraph({ children: [new PageBreak()] }),

          // 1. Introduction
          heading('1. Introduction'),
          body('The introduction should establish the context and background of your research.'),
          placeholder('Provide background information and context for your study.'),
          placeholder('State the problem or gap in existing knowledge.'),
          placeholder('Explain the significance and rationale of your study.'),
          placeholder('State your research objectives or questions.'),

          // 2. Methods
          heading('2. Methods'),
          placeholder('Describe your research design (e.g., experimental, survey, case study).'),

          heading('2.1 Participants / Study Setting', HeadingLevel.HEADING_2),
          placeholder('Describe the participants, sample size, selection criteria, and setting.'),

          heading('2.2 Data Collection', HeadingLevel.HEADING_2),
          placeholder('Describe instruments, tools, or protocols used to collect data.'),

          heading('2.3 Data Analysis', HeadingLevel.HEADING_2),
          placeholder('Describe the statistical or analytical methods used.'),

          // 3. Results
          heading('3. Results'),
          placeholder('Present your findings objectively. Use tables and figures where appropriate.'),
          placeholder('Table 1: [Description of table]'),

          // 4. Discussion
          heading('4. Discussion'),
          placeholder('Interpret the results in the context of your research question.'),
          placeholder('Compare your findings with existing literature.'),
          placeholder('Discuss limitations and their potential impact.'),

          // 5. Conclusion
          heading('5. Conclusion'),
          placeholder('Summarize the main findings and their significance.'),
          placeholder('State the practical implications and recommendations for future research.'),

          // References
          heading('References'),
          placeholder('List all references cited in the text using your required citation style.'),
          placeholder('[1] Author, A. A. (Year). Title of work. Publisher.'),
        ],
      },
    ],
  });
}

/**
 * Build an IEEE-formatted document template.
 */
function buildIeeTemplate(title) {
  const heading = (text, level = HeadingLevel.HEADING_1) =>
    new Paragraph({
      text,
      heading: level,
      spacing: { before: 240, after: 120 },
    });

  const body = (text) =>
    new Paragraph({
      children: [new TextRun({ text, size: 22 })],
      spacing: { after: 160 },
    });

  const placeholder = (text) =>
    new Paragraph({
      children: [new TextRun({ text: `[${text}]`, size: 22, italics: true, color: '888888' })],
      spacing: { after: 160 },
    });

  return new Document({
    styles: {
      default: {
        document: {
          run: { font: 'Times New Roman', size: 22 },
        },
      },
    },
    sections: [
      {
        children: [
          // Title — IEEE style: title case, centered, large
          new Paragraph({
            children: [new TextRun({ text: title, bold: true, size: 40, font: 'Arial' })],
            alignment: AlignmentType.CENTER,
            spacing: { after: 200 },
          }),

          // Authors
          new Paragraph({
            children: [
              new TextRun({
                text: '[First Author]',
                italics: true,
                size: 22,
                color: '555555',
              }),
            ],
            alignment: AlignmentType.CENTER,
            spacing: { after: 80 },
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: '[Institution Name, City, Country]',
                italics: true,
                size: 20,
                color: '888888',
              }),
            ],
            alignment: AlignmentType.CENTER,
            spacing: { after: 80 },
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: '[email@institution.edu]',
                italics: true,
                size: 20,
                color: '888888',
              }),
            ],
            alignment: AlignmentType.CENTER,
            spacing: { after: 400 },
          }),

          // Abstract — IEEE uses italic "Abstract—" inline
          new Paragraph({
            children: [
              new TextRun({ text: 'Abstract', bold: true, italics: true, size: 22 }),
              new TextRun({ text: '—', size: 22 }),
              new TextRun({
                text: '[Write a concise abstract of 150–250 words summarizing the paper\'s purpose, methods, results, and conclusion.]',
                italics: true,
                size: 22,
                color: '888888',
              }),
            ],
            spacing: { after: 200 },
          }),

          // Keywords
          new Paragraph({
            children: [
              new TextRun({ text: 'Index Terms', italics: true, bold: true, size: 22 }),
              new TextRun({ text: '—', size: 22 }),
              new TextRun({
                text: '[component, formatting, style, styling, insert]',
                italics: true,
                size: 22,
                color: '888888',
              }),
            ],
            spacing: { after: 400 },
          }),

          new Paragraph({ children: [new PageBreak()] }),

          // I. Introduction
          heading('I. Introduction'),
          body('This section should motivate the problem and outline the paper\'s contributions.'),
          placeholder('Provide background and context for your research area.'),
          placeholder('Clearly state the problem being addressed.'),
          placeholder('Summarize your contributions (use a bulleted list if needed).'),
          placeholder('Outline the structure of the paper.'),

          // II. Related Work
          heading('II. Related Work'),
          placeholder('Review prior work relevant to your study.'),
          placeholder('Contrast your approach with existing solutions.'),

          // III. Methodology
          heading('III. Methodology'),
          placeholder('Describe the system design or experimental setup.'),

          heading('A. System Architecture', HeadingLevel.HEADING_2),
          placeholder('Provide a high-level overview of your proposed system or method.'),

          heading('B. Implementation Details', HeadingLevel.HEADING_2),
          placeholder('Describe tools, technologies, datasets, and parameters.'),

          // IV. Results
          heading('IV. Results and Discussion'),
          placeholder('Present quantitative/qualitative results.'),
          placeholder('Discuss the significance of your findings.'),
          placeholder('Include tables or figures as appropriate.'),
          placeholder('Table I: [Comparison of methods / Performance metrics]'),

          // V. Conclusion
          heading('V. Conclusion'),
          placeholder('Summarize the key contributions and findings.'),
          placeholder('Discuss limitations and future work.'),

          // Acknowledgment
          heading('Acknowledgment', HeadingLevel.HEADING_2),
          placeholder('Acknowledge funding sources, advisors, or collaborators (optional).'),

          // References
          heading('References'),
          body('IEEE format: [1] Author(s), "Title," Journal/Conf., vol., no., pp., Month Year, doi.'),
          placeholder('[1] A. Author, "Paper title," IEEE Trans. on X, vol. 1, no. 1, pp. 1–10, Jan. 2024.'),
        ],
      },
    ],
  });
}

/**
 * Generate a .docx Buffer for the given paper standard.
 * @param {string} paperStandard - 'imrad' | 'ieee' | 'apa' | 'mla'
 * @param {string} title - Project title used as the document title
 * @returns {Promise<Buffer>}
 */
async function generateDocxTemplate(paperStandard, title) {
  const standard = (paperStandard || 'ieee').toLowerCase();
  const doc = standard === 'imrad' ? buildImradTemplate(title) : buildIeeTemplate(title);
  return Packer.toBuffer(doc);
}

module.exports = { generateDocxTemplate };
