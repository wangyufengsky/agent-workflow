(() => {
  const model = window.__AW_DESIGN_DATA__;
  const site = document.getElementById('design-site');
  const svgNamespace = 'http://www.w3.org/2000/svg';
  const C = window.__AW_DESIGN_SITE_COPY__;
  const diagramLabel = C.diagramKinds;
  const copy = (key, fields) => C[key].replace(/\{(\w+)\}/g, (_token, name) => fields[name]);
  const sectionById = new Map(model.sections.map((item) => [item.id, item]));
  const fileById = new Map(model.files.map((item) => [item.id, item]));
  const fileByPath = new Map(model.files.map((item) => [item.relPath, item]));
  const diagramById = new Map(model.diagrams.map((item) => [item.id, item]));
  const profiles = model.sections.flatMap((section) =>
    section.blocks.filter(({ type }) => type === 'transaction').map((profile) => ({ ...profile, section })),
  );
  const transactionGraphs = new Map(profiles.map((profile) => [profile.diagramId, profile]));
  const searchIndex = [];
  let activeHash = '';
  let diagramSerial = 0;

  function el(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className !== undefined) node.className = className;
    return node;
  }

  function svg(tag, attributes = {}) {
    const node = document.createElementNS(svgNamespace, tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
    return node;
  }

  function hash(...parts) {
    return `#${parts.map(encodeURIComponent).join('/')}`;
  }

  function route() {
    try {
      return location.hash.slice(1).split('/').map(decodeURIComponent);
    } catch {
      return [];
    }
  }

  function link(text, target, className) {
    const a = el('a', text, className);
    a.href = target;
    return a;
  }

  function sectionLink(section) {
    return link(section.title, hash('section', section.id));
  }

  function graphLink(diagram) {
    return link(diagram.title, hash('diagram', diagram.id));
  }

  function button(text, action, title) {
    const node = el('button', text);
    node.type = 'button';
    if (title !== undefined) node.setAttribute('aria-label', title);
    node.addEventListener('click', action);
    return node;
  }

  function copyPath(path) {
    if (navigator.clipboard === undefined) {
      copyWithSelection(path);
      return;
    }
    navigator.clipboard.writeText(path).catch(() => copyWithSelection(path));
  }

  function copyWithSelection(path) {
    const input = el('textarea');
    input.value = path;
    input.className = 'clipboard';
    document.body.append(input);
    input.select();
    if (!document.execCommand('copy')) window.prompt(C.copyPath, path);
    input.remove();
  }

  function pathLink(path, start, end) {
    const target = fileByPath.get(path);
    const label = path + (start === undefined ? '' : `:${start}${end === start || end === undefined ? '' : `–${end}`}`);
    return target === undefined
      ? el('code', label)
      : link(label, hash('file', target.id, ...(start === undefined ? [] : ['', start, end ?? start])), 'source-link');
  }

  function inline(parent, value) {
    const parts = value.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g);
    for (const part of parts) {
      if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
        parent.append(el('code', part.slice(1, -1)));
      } else if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
        parent.append(el('strong', part.slice(2, -2)));
      } else if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
        parent.append(el('em', part.slice(1, -1)));
      } else {
        const match = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
        const target = match === null ? undefined : fileByPath.get(match[2]);
        parent.append(
          target === undefined ? (match === null ? part : match[1]) : link(match[1], hash('file', target.id)),
        );
      }
    }
  }

  function markdown(text) {
    const fragment = document.createDocumentFragment();
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    const listMarker = /^\s*(?:[-*+] |\d+\. )/;
    const tableSeparator = /^\s*\|?\s*:?-{3,}/;
    const heading = /^(#{1,6})\s+(.+)/;
    let position = 0;
    const lineAt = () => lines[position] || '';
    while (position < lines.length) {
      const line = lineAt();
      position += 1;
      if (line.trim() === '') continue;
      if (line.startsWith('```')) {
        const rows = [];
        while (position < lines.length && !lineAt().startsWith('```')) rows.push(lines[position++]);
        position += 1;
        const pre = el('pre');
        pre.append(el('code', rows.join('\n')));
        fragment.append(pre);
        continue;
      }
      const header = heading.exec(line);
      if (header !== null) {
        const node = el(`h${Math.min(6, header[1].length + 2)}`);
        inline(node, header[2]);
        fragment.append(node);
        continue;
      }
      if (listMarker.test(line)) {
        const ordered = /^\s*\d+\. /;
        const list = el(ordered.test(line) ? 'ol' : 'ul');
        const item = (value) => {
          const li = el('li');
          inline(li, value.replace(listMarker, ''));
          list.append(li);
        };
        item(line);
        while (position < lines.length && listMarker.test(lineAt()) && ordered.test(lineAt()) === ordered.test(line)) {
          item(lines[position++]);
        }
        fragment.append(list);
        continue;
      }
      if (line.includes('|') && tableSeparator.test(lineAt())) {
        const cells = (value) =>
          value
            .trim()
            .replace(/^\||\|$/g, '')
            .split('|')
            .map((cell) => cell.trim());
        position += 1;
        const rows = [];
        while (position < lines.length && lineAt().includes('|')) rows.push(cells(lines[position++]));
        fragment.append(table(cells(line), rows));
        continue;
      }
      if (line.startsWith('> ')) {
        const quote = el('blockquote');
        inline(quote, line.slice(2));
        fragment.append(quote);
        continue;
      }
      const paragraph = el('p');
      const rows = [line];
      while (
        position < lines.length &&
        lineAt().trim() !== '' &&
        !heading.test(lineAt()) &&
        !lineAt().startsWith('```') &&
        !lineAt().startsWith('> ') &&
        !listMarker.test(lineAt())
      ) {
        rows.push(lines[position++]);
      }
      inline(paragraph, rows.join(' '));
      fragment.append(paragraph);
    }
    return fragment;
  }

  function table(columns, rows, caption) {
    const wrapper = el('div', undefined, 'table-scroll');
    const result = el('table');
    if (caption !== undefined) result.append(el('caption', caption));
    const header = result.createTHead().insertRow();
    for (const column of columns) {
      const cell = el('th', column);
      cell.scope = 'col';
      header.append(cell);
    }
    const body = result.createTBody();
    for (const row of rows) {
      const tr = body.insertRow();
      for (const value of row) tr.insertCell().textContent = value;
    }
    wrapper.append(result);
    return wrapper;
  }

  function evidenceList(evidence) {
    const list = el('ul', undefined, 'evidence');
    for (const item of evidence) {
      const li = el('li', item.evidenceClass === 'static' ? `${C.sourceEvidence} · ` : `${C.inference} · `);
      li.append(
        item.evidenceClass === 'static' ? pathLink(item.relPath, item.lineStart, item.lineEnd) : item.rationale,
      );
      list.append(li);
    }
    return list;
  }

  // 只给已引用的文本着色，不解析或补齐缺失源码。
  const syntaxPattern =
    /(\/\/.*|#.*|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[^`]*`|\b(?:class|interface|enum|record|extends|const|let|var|public|protected|private|static|final|new|return|if|else|for|while|import|export|from|async|await|function|package|try|catch|throw|throws|switch|case|def|fn|struct|true|false|null|None|SELECT|FROM|WHERE|INSERT|UPDATE|const)\b|\b\d+(?:\.\d+)?\b)/g;
  function coloredLine(line) {
    const pieces = document.createDocumentFragment();
    let cursor = 0;
    for (const match of line.matchAll(syntaxPattern)) {
      const value = match[0];
      pieces.append(line.slice(cursor, match.index));
      const kind =
        value.startsWith('//') || value.startsWith('#')
          ? 'comment'
          : value.startsWith('"') || value.startsWith("'") || value.startsWith('`')
            ? 'string'
            : /^\d/.test(value)
              ? 'number'
              : 'keyword';
      pieces.append(el('span', value, `syntax-${kind}`));
      cursor = match.index + value.length;
    }
    pieces.append(line.slice(cursor));
    return pieces;
  }

  function codeExcerpt(block, focus) {
    const pre = el('pre');
    const code = el('code');
    for (const [index, line] of block.code.split(/\r?\n/).entries()) {
      const row = el('span', undefined, 'code-line');
      const coordinate = block.lineStart + index;
      if (coordinate > block.lineEnd) break;
      row.dataset.line = String(coordinate);
      if (focus !== undefined && coordinate >= focus.start && coordinate <= focus.end) row.dataset.focus = 'true';
      const number = el('span', String(coordinate), 'code-number');
      number.setAttribute('aria-hidden', 'true');
      row.append(number, coloredLine(line));
      code.append(row);
    }
    pre.append(code);
    return pre;
  }

  function sourceExcerpts(file, focus) {
    const excerpts = model.sections.flatMap(({ blocks }) =>
      blocks.filter((block) => block.type === 'code' && block.relPath === file.relPath),
    );
    const area = el('section', undefined, 'source-excerpts');
    area.append(el('h2', C.sourceExcerpts));
    const found =
      focus === undefined || excerpts.some((block) => block.lineStart <= focus.end && block.lineEnd >= focus.start);
    if (excerpts.length === 0 || !found) area.append(el('p', C.noExcerpt, 'muted'));
    const distinct = new Map(excerpts.map((block) => [`${block.lineStart}:${block.lineEnd}`, block]));
    for (const block of distinct.values()) {
      area.append(
        el('p', copy('symbolLines', { start: block.lineStart, end: block.lineEnd }), 'hint'),
        codeExcerpt(block, focus),
      );
    }
    return area;
  }

  function renderBlock(block) {
    if (block.type === 'diagram_ref') {
      const diagram = diagramById.get(block.diagramId);
      return diagram === undefined ? null : renderDiagram(diagram, false);
    }
    const area = el('section', undefined, 'content-block');
    if (block.title) area.append(el('h2', block.title));
    if (block.type === 'transaction') {
      area.append(
        el('p', [block.code, block.channel, block.version, block.scenario].filter(Boolean).join(' · ')),
        evidenceList(block.evidence),
      );
    } else if (block.type === 'markdown') {
      area.append(markdown(block.markdown));
      if (block.evidence && block.evidence.length > 0) area.append(evidenceList(block.evidence));
    } else if (block.type === 'table') {
      area.append(table(block.columns, block.rows, block.caption));
    } else if (block.type === 'code') {
      area.append(pathLink(block.relPath, block.lineStart, block.lineEnd));
      area.append(codeExcerpt(block));
    } else if (block.type === 'callout') {
      area.classList.add('callout', block.tone === 'warn' ? 'warning' : 'info');
      area.append(markdown(block.body));
    }
    return area;
  }

  function linkList(title, entries) {
    const area = el('section', undefined, 'link-list');
    area.append(el('h2', title));
    const list = el('ul');
    for (const item of entries) {
      const li = el('li');
      li.append(item);
      list.append(li);
    }
    area.append(list);
    return area;
  }

  function submoduleTarget(section, submodule) {
    return hash('submodule', section.id, submodule.id);
  }

  function partsOf(section) {
    return section.blocks.filter(({ type }) => type === 'submodule');
  }

  function filesOf(section) {
    return model.files.filter(({ sectionId }) => sectionId === section.id);
  }

  const sectionItem = (section) => ({
    title: section.title,
    summary: section.summary,
    kind: section.kind === 'module' ? C.module : C.chapter,
    target: hash('section', section.id),
  });
  const submoduleItem = (section, item) => ({
    title: item.title,
    summary: item.summary,
    kind: C.submodule,
    target: submoduleTarget(section, item),
  });
  const fileItem = (file) => ({
    title: file.relPath,
    summary: file.responsibility,
    kind: C.file,
    target: hash('file', file.id),
  });

  function structure(title, children) {
    const frame = el('div', undefined, 'structure-frame');
    if (children.length === 0) {
      frame.append(el('p', C.noComposition, 'muted'));
      return frame;
    }
    const controls = el('div', undefined, 'graph-controls');
    const cols = Math.min(4, children.length);
    const width = Math.max(380, cols * 220);
    const height = 130 + Math.ceil(children.length / cols) * 100;
    const canvas = svg('svg', { role: 'group', 'aria-label': C.structure, class: 'graph-canvas composition-canvas' });
    const endPoints = children.map((_, i) => {
      const row = Math.floor(i / cols);
      const inRow = Math.min(cols, children.length - row * cols);
      return { x: width / 2 + ((i % cols) - (inRow - 1) / 2) * 220, y: 119 + row * 100 };
    });
    for (const { x, y } of endPoints) {
      canvas.append(
        svg('path', {
          d: `M ${width / 2} 66 V ${y - 22} H ${x} V ${y}`,
          class: 'graph-edge',
        }),
      );
    }
    function node(item, x, y) {
      const graphic =
        item.target === undefined ? svg('g') : svg('a', { href: item.target, tabindex: 0, 'aria-label': item.title });
      graphic.setAttribute('class', 'graph-node');
      if (item.target !== undefined)
        graphic.addEventListener('keydown', (event) => {
          if (event.key === ' ') {
            event.preventDefault();
            location.hash = item.target;
          }
        });
      const characters = Array.from(item.title.split('/').at(-1));
      const tooltip = svg('title');
      tooltip.textContent = item.title;
      const caption = svg('text', { x, y: y + 21, 'text-anchor': 'middle' });
      caption.textContent = characters.length > 18 ? `${characters.slice(0, 17).join('')}…` : characters.join('');
      const kind = svg('text', { x, y: y + 39, 'text-anchor': 'middle', class: 'node-group' });
      kind.textContent = item.kind;
      graphic.append(tooltip, svg('rect', { x: x - 98, y, width: 196, height: 49, rx: 8 }), caption, kind);
      canvas.append(graphic);
    }
    node({ title, kind: C.structure }, width / 2, 17);
    for (const [i, child] of children.entries()) node(child, endPoints[i].x, endPoints[i].y);
    graphNavigation(canvas, controls, width, height);
    frame.append(controls, canvas);
    return frame;
  }

  function architecture(title, label, children, diagrams) {
    const area = el('section', undefined, 'architecture');
    area.append(el('h2', label));
    const options = el('div', undefined, 'view-options');
    const panel = el('div');
    const select = (mode) => {
      composition.setAttribute('aria-pressed', String(mode === 'structure'));
      dependencies.setAttribute('aria-pressed', String(mode !== 'structure'));
      panel.replaceChildren();
      if (mode === 'structure') panel.append(structure(title, children));
      else if (diagrams.length === 0) panel.append(el('p', C.noDependencies, 'muted'));
      else for (const diagram of diagrams) panel.append(renderDiagram(diagram, false));
    };
    const composition = button(C.structure, () => select('structure'));
    const dependencies = button(C.dependencies, () => select('dependencies'));
    options.append(composition, dependencies);
    area.append(options, panel);
    select('structure');
    return area;
  }

  function compositionCards(label, children) {
    if (children.length === 0) return null;
    const area = el('section', undefined, 'architecture-cards');
    const grid = el('div', undefined, 'architecture-card-grid');
    for (const child of children) {
      const card = link('', child.target, 'architecture-card');
      card.append(el('span', child.kind, 'eyebrow'), el('strong', child.title));
      if (child.summary) card.append(el('span', child.summary, 'muted'));
      grid.append(card);
    }
    area.append(el('h2', label), grid);
    return area;
  }

  function transactionCatalog() {
    const labels = C.transactions;
    const area = el('section', undefined, 'transaction-catalog');
    const grid = el('div', undefined, 'transaction-grid');
    const directory = el('div');
    area.setAttribute('aria-label', labels.catalog);
    directory.append(el('h2', labels.catalog));
    grid.append(directory);
    area.append(grid);
    if (!profiles.length) {
      directory.append(el('p', labels.empty, 'muted'));
      return area;
    }
    const filter = el('input');
    filter.type = 'search';
    filter.placeholder = labels.filter;
    filter.setAttribute('aria-label', labels.filter);
    const listing = el('div');
    const preview = el('div', undefined, 'transaction-canvas');
    let selected;
    function fill() {
      const terms = filter.value.trim().toLocaleLowerCase().split(/\s+/);
      const visible = profiles.filter(({ title, code, channel, version, scenario }) => {
        const values = [title, code, channel, version, scenario].join(' ').toLocaleLowerCase();
        return terms.every((term) => values.includes(term));
      });
      const active = visible.find(({ diagramId }) => diagramId === selected) ?? visible[0];
      preview.replaceChildren();
      if (!active) {
        listing.replaceChildren(el('p', labels.noMatch));
        return;
      }
      const list = el('ul', undefined, 'transaction-list');
      for (const entry of visible) {
        const select = button('', () => {
          selected = entry.diagramId;
          fill();
          listing.querySelector('[aria-pressed="true"]').focus();
        });
        select.setAttribute('aria-pressed', String(active === entry));
        select.append(el('strong', entry.title));
        if (entry.code) select.append(el('code', entry.code));
        select.append(el('small', [entry.channel, entry.version, entry.scenario].filter(Boolean).join(' · ')));
        const row = el('li');
        row.append(select);
        list.append(row);
      }
      listing.replaceChildren(list);
      preview.append(
        link(labels.chapter, hash('section', active.section.id)),
        renderDiagram(diagramById.get(active.diagramId), false),
      );
    }
    filter.addEventListener('input', fill);
    directory.append(filter, listing);
    grid.append(preview);
    fill();
    return area;
  }

  function renderHome() {
    const home = el('article');
    const overview = model.sections.find(({ kind }) => kind === 'overview');
    const candidates = model.sections.filter(({ kind }) => kind !== 'overview');
    const modules = candidates.filter(({ kind }) => kind === 'module');
    const structureSections = modules.length > 0 ? modules : candidates;
    const introduction = overview?.summary || structureSections.find(({ summary }) => summary.trim() !== '')?.summary;
    home.append(
      el('span', C.projectOverview, 'eyebrow'),
      el('h1', model.title),
      el(
        'p',
        introduction || copy('reportCoverage', { sections: model.sections.length, files: model.files.length }),
        'summary',
      ),
    );
    if (model.sourceSnapshot?.techStack.length > 0) {
      const tech = el('ul', undefined, 'tech-stack');
      for (const item of model.sourceSnapshot.techStack) tech.append(el('li', item));
      home.append(tech);
    }
    const children = structureSections.map(sectionItem);
    const cards = compositionCards(C.projectOutline, model.sections.map(sectionItem));
    if (model.transactionExplorer) home.append(transactionCatalog());
    if (cards !== null) home.append(cards);
    if (!model.transactionExplorer)
      home.append(
        architecture(
          model.title,
          C.architecture,
          children,
          model.diagrams.filter(({ kind }) => kind === 'architecture'),
        ),
      );
    if (overview)
      for (const block of overview.blocks.filter(({ type }) => type !== 'diagram_ref' && type !== 'submodule')) {
        const body = renderBlock(block);
        if (body !== null) home.append(body);
      }
    return home;
  }

  function renderSubmodule(section, submodule) {
    const article = el('article');
    article.append(
      el('span', C.submodule, 'eyebrow'),
      el('h1', submodule.title),
      el('p', submodule.summary, 'summary'),
    );
    const children = submodule.files
      .map((path) => fileByPath.get(path))
      .filter(Boolean)
      .map(fileItem);
    const sectionDiagrams = model.diagrams.filter(
      ({ sectionId, nodes }) =>
        sectionId === section.id && nodes.some((node) => submodule.files.includes(node.relPath ?? node.targetId)),
    );
    article.append(architecture(submodule.title, C.internalArchitecture, children, sectionDiagrams));
    if (submodule.behaviors.length > 0) {
      const explanations = el('section');
      explanations.append(el('h2', C.behaviors));
      for (const behavior of submodule.behaviors) explanations.append(renderBlock({ ...behavior, type: 'markdown' }));
      article.append(explanations);
    }
    const cards = compositionCards(C.composition, children);
    if (cards !== null) article.append(cards);
    return article;
  }

  function renderSection(section) {
    const content = el('article');
    content.append(el('span', sectionItem(section).kind, 'eyebrow'), el('h1', section.title));
    const graphs = model.diagrams.filter(({ sectionId }) => sectionId === section.id);
    const parts = partsOf(section);
    const allocated = new Set(parts.flatMap(({ files }) => files));
    const files = filesOf(section).filter(({ relPath }) => !allocated.has(relPath));
    const children = [...parts.map((item) => submoduleItem(section, item)), ...files.map(fileItem)];
    const graphsFirst = model.layoutStyle === 'arch';
    const rendered = new Set();
    if (section.summary) content.append(el('p', section.summary, 'summary'));
    if (graphsFirst && children.length > 0) {
      content.append(architecture(section.title, C.internalArchitecture, children, graphs));
      for (const graph of graphs) rendered.add(graph.id);
    } else if (graphsFirst) {
      for (const graph of graphs) {
        content.append(renderDiagram(graph, false));
        rendered.add(graph.id);
      }
    } else if (children.length > 0) {
      const area = el('section');
      area.append(el('h2', C.internalArchitecture), structure(section.title, children));
      content.append(area);
    }
    const behaviors = graphsFirst
      ? section.blocks.filter((block) => block.type === 'markdown' && block.title && block.evidence?.length > 0)
      : [];
    if (behaviors.length > 0) {
      const explanations = el('section');
      explanations.append(el('h2', C.behaviors));
      for (const behavior of behaviors) explanations.append(renderBlock(behavior));
      content.append(explanations);
    }
    const cards = compositionCards(C.composition, children);
    if (graphsFirst && cards !== null) content.append(cards);
    for (const block of section.blocks) {
      if (block.type === 'submodule' || behaviors.includes(block)) continue;
      if (block.type === 'diagram_ref') {
        if (rendered.has(block.diagramId)) continue;
        rendered.add(block.diagramId);
      }
      const body = renderBlock(block);
      if (body !== null) content.append(body);
    }
    const extraGraphs = graphs.filter(({ id }) => !rendered.has(id));
    if (extraGraphs.length > 0) content.append(linkList(C.relatedDiagrams, extraGraphs.map(graphLink)));
    if (!graphsFirst && cards !== null) content.append(cards);
    return content;
  }

  function renderFile(file, currentSymbol, range) {
    const content = el('article');
    content.append(el('span', C.file, 'eyebrow'), el('h1', file.relPath, 'file-title'));
    content.append(button(C.copyPath, () => copyPath(file.relPath)));
    if (file.responsibility) content.append(el('p', file.responsibility, 'summary'));
    const focus = file.symbols.find(({ id }) => id === currentSymbol);
    const selection = range ?? (focus === undefined ? undefined : { start: focus.lineStart, end: focus.lineEnd });
    const children = file.symbols.map((symbol) => ({
      title: symbol.qualifiedName,
      summary: symbol.summary,
      kind: symbol.kind,
      target: hash('file', file.id, symbol.id),
    }));
    const related = model.diagrams.filter(({ nodes }) =>
      nodes.some(
        (node) => node.relPath === file.relPath || node.targetId === file.id || node.targetId === file.relPath,
      ),
    );
    content.append(architecture(file.relPath, C.fileArchitecture, children, related));
    content.append(sourceExcerpts(file, selection));
    if (file.symbols.length > 0) content.append(el('h2', C.fileSymbols));
    for (const symbol of file.symbols) {
      const section = el('section', undefined, 'symbol');
      section.dataset.symbolId = symbol.id;
      const heading = el('h3');
      heading.append(link(symbol.qualifiedName, hash('file', file.id, symbol.id)));
      section.append(
        heading,
        el('p', `${symbol.kind} · ${copy('symbolLines', { start: symbol.lineStart, end: symbol.lineEnd })}`, 'muted'),
      );
      if (symbol.signature) {
        const pre = el('pre');
        pre.append(el('code', symbol.signature));
        section.append(pre);
      }
      section.append(markdown(symbol.summary));
      for (const [label, items] of [
        [C.throws, symbol.throws],
        [C.callers, symbol.callers],
        [C.callees, symbol.callees],
      ]) {
        if (items && items.length > 0) section.append(el('p', `${label} · ${items.join('、')}`));
      }
      if (symbol.id === currentSymbol) {
        section.classList.add('highlight');
      }
      content.append(section);
    }
    if (selection !== undefined)
      requestAnimationFrame(() => {
        const target = content.querySelector('.code-line[data-focus]') ?? content.querySelector('.symbol.highlight');
        target?.scrollIntoView({ block: 'center' });
      });
    return content;
  }

  function nodeTarget(node) {
    if (node.targetKind === 'section' || node.targetKind === 'module') {
      if (sectionById.has(node.targetId)) return hash('section', node.targetId);
      for (const section of model.sections) {
        const submodule = partsOf(section).find(({ id }) => id === node.targetId);
        if (submodule !== undefined) return submoduleTarget(section, submodule);
      }
    }
    const file = fileById.get(node.targetId) || fileByPath.get(node.relPath) || fileByPath.get(node.targetId);
    if (node.targetKind === 'symbol') {
      const match = file
        ? {
            file,
            symbol: file.symbols.find((item) => item.id === node.targetId || item.qualifiedName === node.targetId),
          }
        : model.files
            .map((candidate) => ({
              file: candidate,
              symbol: candidate.symbols.find(
                (item) => item.id === node.targetId || item.qualifiedName === node.targetId,
              ),
            }))
            .find(({ symbol }) => symbol !== undefined);
      if (match?.symbol) return hash('file', match.file.id, match.symbol.id);
    }
    return file === undefined ? undefined : hash('file', file.id);
  }

  function graphNavigation(element, controls, width, height) {
    const area = { x: 0, y: 0, width, height };
    const view = { ...area };
    const refresh = () => element.setAttribute('viewBox', [view.x, view.y, view.width, view.height].join(' '));
    const zoom = (factor) => {
      const width = Math.max(area.width / 8, Math.min(area.width * 3, view.width * factor));
      const height = (width * area.height) / area.width;
      view.x += (view.width - width) / 2;
      view.y += (view.height - height) / 2;
      view.width = width;
      view.height = height;
      refresh();
    };
    const reset = () => {
      Object.assign(view, area);
      refresh();
    };
    controls.append(
      button('＋', () => zoom(0.8), C.zoomIn),
      button('−', () => zoom(1.25), C.zoomOut),
      button(C.fitShort, reset, C.fit),
    );
    element.setAttribute('tabindex', '0');
    element.setAttribute('aria-description', C.graphControlsHelp);
    const direction = { ArrowLeft: [-1, 0], ArrowUp: [0, -1], ArrowRight: [1, 0], ArrowDown: [0, 1] };
    element.addEventListener('keydown', (event) => {
      if (event.target !== element) return;
      if (Object.hasOwn(direction, event.key)) {
        const [x, y] = direction[event.key];
        view.x += (x * view.width) / 10;
        view.y += (y * view.height) / 10;
        refresh();
      } else if (event.key === '+' || event.key === '=') zoom(0.8);
      else if (event.key === '-') zoom(1.25);
      else if (event.key === 'Home') reset();
      else return;
      event.preventDefault();
    });
    element.addEventListener(
      'wheel',
      (event) => {
        if (!event.ctrlKey && !event.metaKey) return;
        event.preventDefault();
        zoom(event.deltaY < 0 ? 0.8 : 1.25);
      },
      { passive: false },
    );
    let drag;
    element.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || event.target.closest('a, [role=button]')) return;
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
      element.setPointerCapture(event.pointerId);
    });
    element.addEventListener('pointermove', (event) => {
      if (drag === undefined || drag.id !== event.pointerId) return;
      const size = element.getBoundingClientRect();
      const scale = Math.max(view.width / size.width, view.height / size.height);
      view.x -= (event.clientX - drag.x) * scale;
      view.y -= (event.clientY - drag.y) * scale;
      Object.assign(drag, { x: event.clientX, y: event.clientY });
      refresh();
    });
    element.addEventListener('lostpointercapture', () => {
      drag = undefined;
    });
    refresh();
  }

  function edgeEvidence(edge, nodes) {
    const kind = edge.evidenceClass === 'static' ? C.static : C.inference;
    const label = edge.label || edge.kind;
    const endpoint = (id) => {
      const node = nodes.get(id);
      if (node === undefined) return id;
      const target = nodeTarget(node);
      return target === undefined ? node.label : link(node.label, target);
    };
    const content = document.createDocumentFragment();
    content.append(endpoint(edge.from), ` → ${label} → `, endpoint(edge.to), el('span', kind, 'evidence-tag'));
    if (edge.evidencePath) content.append(' ', pathLink(edge.evidencePath, edge.lineStart, edge.lineEnd));
    if (edge.rationale) content.append(el('p', edge.rationale, 'muted'));
    const name = `${nodes.get(edge.from)?.label ?? edge.from} → ${label} → ${nodes.get(edge.to)?.label ?? edge.to} · ${kind}`;
    return { content, name };
  }

  function graphInspector(id) {
    const panel = el('div', undefined, 'graph-inspector');
    panel.id = id;
    panel.hidden = true;
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', C.edgeEvidence);
    let active;
    function clear() {
      active?.setAttribute('aria-pressed', 'false');
      active = undefined;
      panel.hidden = true;
      panel.replaceChildren();
    }
    return {
      panel,
      clear,
      toggle(control, evidence, label = C.edgeEvidence) {
        const same = active === control;
        clear();
        if (same) return;
        active = control;
        active.setAttribute('aria-pressed', 'true');
        panel.setAttribute('aria-label', label);
        panel.replaceChildren(el('strong', label), evidence.cloneNode(true));
        panel.hidden = false;
      },
    };
  }

  function graphEdge(route, edge, markerId, nodes, inspector) {
    const evidence = edgeEvidence(edge, nodes);
    const control = svg('g', {
      role: 'button',
      tabindex: 0,
      'aria-label': evidence.name,
      'aria-controls': inspector.panel.id,
      'aria-pressed': 'false',
      class: 'graph-edge-target',
    });
    const title = svg('title');
    title.textContent = evidence.content.textContent;
    control.append(
      title,
      svg('path', {
        d: route.path,
        class: `graph-edge${edge.evidenceClass === 'inferred' ? ' inferred' : ''}`,
        'marker-end': `url(#${markerId})`,
      }),
      svg('path', { d: route.path, class: 'graph-edge-hit' }),
    );
    const activate = () => inspector.toggle(control, evidence.content);
    control.addEventListener('click', activate);
    control.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        activate();
      }
      if (event.key === 'Escape') inspector.clear();
    });
    return control;
  }

  function graphSvg(diagram, nodes, width, height, controls, serial, inspector) {
    const canvas = svg('svg', { role: 'group', 'aria-label': diagram.title, class: 'graph-canvas' });
    const markerId = `arrow-${serial}`;
    const defs = svg('defs');
    const arrow = svg('marker', { id: markerId, markerWidth: 8, markerHeight: 8, refX: 8, refY: 4, orient: 'auto' });
    arrow.append(svg('path', { d: 'M 0 0 L 8 4 L 0 8 Z', class: 'arrow' }));
    defs.append(arrow);
    canvas.append(defs);
    const edges = new Map(diagram.edges.map((edge) => [edge.id, edge]));
    for (const route of diagram.layout.routes) {
      const edge = edges.get(route.id);
      if (edge !== undefined) canvas.append(graphEdge(route, edge, markerId, nodes, inspector));
    }
    for (const { id, box } of diagram.layout.placed) {
      const node = nodes.get(id);
      if (node === undefined) continue;
      const target = nodeTarget(node);
      const inspect = transactionGraphs.has(diagram.id);
      const item = inspect
        ? svg('g', {
            role: 'button',
            tabindex: 0,
            'aria-label': node.label,
            'aria-pressed': 'false',
            'aria-controls': inspector.panel.id,
          })
        : target === undefined
          ? svg('g')
          : svg('a', { href: target, 'aria-label': node.label });
      if (inspect) {
        const description = el('div');
        description.append(el('b', node.label));
        if (node.summary) description.append(el('p', node.summary));
        if (target) description.append(link(C.transactions.source, target));
        else if (node.relPath) description.append(pathLink(node.relPath));
        const activate = () => inspector.toggle(item, description, C.transactions.steps);
        item.addEventListener('click', activate);
        item.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            activate();
          }
          if (event.key === 'Escape') inspector.clear();
        });
      }
      const unavailable = target === undefined && node.targetKind !== undefined;
      item.setAttribute('class', unavailable ? 'graph-node unavailable' : 'graph-node');
      const title = svg('title');
      title.textContent = [node.label, node.summary, unavailable ? C.unavailableTarget : undefined]
        .filter(Boolean)
        .join(' · ');
      const { x, y, width, height } = box;
      const text = svg('text', { x: x + width / 2, y: y + (node.group ? 22 : 30), 'text-anchor': 'middle' });
      const characters = Array.from(node.label);
      text.textContent = characters.length > 13 ? `${characters.slice(0, 12).join('')}…` : node.label;
      item.append(title, svg('rect', { x, y, width, height, rx: 8 }), text);
      if (node.group) {
        const group = svg('text', { x: x + width / 2, y: y + 39, 'text-anchor': 'middle', class: 'node-group' });
        group.textContent = Array.from(node.group).slice(0, 18).join('');
        item.append(group);
      }
      canvas.append(item);
    }
    graphNavigation(canvas, controls, width, height);
    return canvas;
  }

  function appendTransactionTraces(article, profile, nodes) {
    for (const key of ['fields', 'boundaries']) {
      if (!profile[key]?.length) continue;
      const details = el('details');
      details.append(el('summary', C.transactions[key]));
      const list = el('dl');
      for (const trace of profile[key]) {
        const body = el('dd', trace.steps.map((id) => nodes.get(id).label).join(' → '));
        body.append(el('p', trace.description), evidenceList(trace.evidence));
        list.append(el('dt', trace.name), body);
      }
      details.append(list);
      article.append(details);
    }
  }

  function renderDiagram(diagram, standalone) {
    const article = el(standalone ? 'article' : 'section', undefined, 'diagram');
    const heading = el(standalone ? 'h1' : 'h2');
    heading.append(standalone ? diagram.title : graphLink(diagram));
    const controls = el('div', undefined, 'graph-controls');
    controls.append(el('span', diagramLabel[diagram.kind], 'muted'));
    const nodes = new Map(diagram.nodes.map((node) => [node.id, node]));
    const serial = ++diagramSerial;
    const inspector = graphInspector(`graph-evidence-${serial}`);
    const graph = graphSvg(diagram, nodes, diagram.layout.width, diagram.layout.height, controls, serial, inspector);
    article.append(heading, controls, graph, inspector.panel);
    const profile = transactionGraphs.get(diagram.id);
    if (profile) appendTransactionTraces(article, profile, nodes);
    const details = el('details');
    details.append(el('summary', copy('edgeList', { count: diagram.edges.length })));
    const list = el('ul', undefined, 'edge-list');
    for (const edge of diagram.edges) {
      const item = el('li');
      item.append(edgeEvidence(edge, nodes).content);
      list.append(item);
    }
    details.append(list);
    article.append(details);
    return article;
  }

  function indexItem(target, label, ...terms) {
    searchIndex.push({ target, label, text: [label, ...terms].join(' ').toLocaleLowerCase() });
  }

  function navGroup(parent, parentLink, children) {
    if (children.childElementCount === 0) {
      parent.append(parentLink);
      return;
    }
    const branch = el('details', undefined, 'tree-branch');
    const summary = el('summary');
    summary.append(parentLink);
    branch.append(summary, children);
    parent.append(branch);
  }

  function fileNav(file) {
    const listItem = el('li');
    const target = hash('file', file.id);
    indexItem(target, file.relPath, file.responsibility);
    const symbols = el('ul');
    for (const symbol of file.symbols) {
      const address = hash('file', file.id, symbol.id);
      const item = el('li');
      item.append(link(symbol.name, address));
      symbols.append(item);
      indexItem(address, symbol.qualifiedName, symbol.name, file.relPath, symbol.summary);
    }
    navGroup(listItem, link(file.relPath, target), symbols);
    return listItem;
  }

  function populateNav(navigation) {
    navigation.append(link(model.title, hash('home'), 'chapter-link'));
    for (const section of model.sections) {
      const heading = sectionLink(section);
      heading.className = 'chapter-link';
      indexItem(heading.getAttribute('href'), section.title, section.summary, JSON.stringify(section.blocks));
      const children = el('ul');
      for (const diagram of model.diagrams.filter(({ sectionId }) => sectionId === section.id)) {
        const item = el('li');
        const a = graphLink(diagram);
        item.append(a);
        children.append(item);
        indexItem(
          a.getAttribute('href'),
          diagram.title,
          diagramLabel[diagram.kind],
          ...diagram.nodes.map(({ label }) => label),
        );
      }
      const allocated = new Set();
      for (const submodule of partsOf(section)) {
        const item = el('li');
        const target = submoduleTarget(section, submodule);
        const files = el('ul');
        indexItem(target, submodule.title, submodule.summary, JSON.stringify(submodule.behaviors));
        for (const path of submodule.files) {
          const file = fileByPath.get(path);
          if (file?.sectionId === section.id) {
            allocated.add(path);
            files.append(fileNav(file));
          }
        }
        navGroup(item, link(submodule.title, target), files);
        children.append(item);
      }
      const direct = filesOf(section).filter(({ relPath }) => !allocated.has(relPath));
      for (const file of direct) children.append(fileNav(file));
      navGroup(navigation, heading, children);
    }
  }

  function renderSearch(query, results) {
    const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    results.hidden = terms.length === 0;
    results.replaceChildren();
    if (results.hidden) return;
    const found = searchIndex.filter(({ text }) => terms.every((term) => text.includes(term)));
    const status = el(
      'p',
      found.length === 0 ? C.noSearchResults : copy('searchResults', { count: found.length }),
      'muted',
    );
    status.setAttribute('role', 'status');
    results.append(status);
    for (const item of found) results.append(link(item.label, item.target));
    setActiveLinks();
  }

  function setActiveLinks() {
    for (const a of site.querySelectorAll('aside a, .search-results a')) {
      if (a.getAttribute('href') === activeHash) {
        a.setAttribute('aria-current', 'page');
        for (let branch = a.closest('details'); branch !== null; branch = branch.parentElement.closest('details'))
          branch.open = true;
      } else a.removeAttribute('aria-current');
    }
  }

  function mount() {
    const sidebar = el('aside');
    const navigation = el('nav');
    navigation.setAttribute('aria-label', C.outline);
    populateNav(navigation);
    sidebar.append(el('p', C.outline, 'site-title'), navigation);
    const header = el('header', undefined, 'site-header');
    const toggle = button(
      '☰',
      () => {
        const open = sidebar.classList.toggle('outline-open');
        toggle.setAttribute('aria-expanded', String(open));
      },
      C.toggleOutline,
    );
    toggle.className = 'outline-toggle';
    toggle.setAttribute('aria-label', C.toggleOutline);
    toggle.setAttribute('aria-expanded', 'false');
    const search = el('div', undefined, 'site-search');
    const input = el('input');
    input.type = 'search';
    input.setAttribute('aria-label', C.searchLabel);
    input.placeholder = C.searchPlaceholder;
    const results = el('div', undefined, 'search-results');
    results.hidden = true;
    input.addEventListener('input', () => renderSearch(input.value, results));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        input.value = '';
        renderSearch('', results);
      }
    });
    results.addEventListener('click', (event) => {
      const target = event.target.closest('a');
      if (target !== null) {
        event.preventDefault();
        location.hash = target.getAttribute('href');
        input.value = '';
        renderSearch('', results);
      }
    });
    search.append(input, results);
    header.append(toggle, link(C.pageTitle, hash('home'), 'site-brand'), search);

    const main = el('main');
    const breadcrumb = el('nav', undefined, 'breadcrumbs');
    breadcrumb.setAttribute('aria-label', C.breadcrumbs);
    const reader = el('div');
    const footer = el('footer', undefined, 'site-note');
    const snapshot = model.sourceSnapshot;
    const date = snapshot?.scannedAt === undefined ? '' : new Date(snapshot.scannedAt).toLocaleDateString();
    const baseline = snapshot?.commitSha
      ? [snapshot.branch, snapshot.commitSha.slice(0, 8)].filter(Boolean).join(' · ')
      : date;
    if (baseline !== '') footer.append(el('span', `${snapshot?.commitSha ? C.version : C.snapshot} · ${baseline}`));
    footer.append(el('span', C.excerptNotice));
    main.append(breadcrumb, reader, footer);
    site.append(header, sidebar, main);

    function show() {
      const [kind, id, symbolId, first, last] = route();
      const file = kind === 'file' ? fileById.get(id) : undefined;
      const diagram = kind === 'diagram' ? diagramById.get(id) : undefined;
      const section = sectionById.get(file?.sectionId || diagram?.sectionId || id);
      const submodule =
        section === undefined
          ? undefined
          : kind === 'submodule'
            ? partsOf(section).find((item) => item.id === symbolId)
            : file === undefined
              ? undefined
              : partsOf(section).find((item) => item.files.includes(file.relPath));
      const symbol = file?.symbols.find((item) => item.id === symbolId);
      const range =
        Number(first) > 0 && Number(last) >= Number(first) ? { start: Number(first), end: Number(last) } : undefined;
      activeHash = file
        ? hash('file', file.id, ...(symbol ? [symbol.id] : []))
        : diagram
          ? hash('diagram', diagram.id)
          : kind === 'submodule' && section && submodule
            ? submoduleTarget(section, submodule)
            : section
              ? hash('section', section.id)
              : hash('home');
      setActiveLinks();
      sidebar.classList.remove('outline-open');
      toggle.setAttribute('aria-expanded', 'false');
      breadcrumb.replaceChildren(link(model.title, hash('home')));
      const step = (item) => breadcrumb.append(el('span', '›'), item);
      if (section) step(file || diagram || submodule ? sectionLink(section) : el('span', section.title));
      if (section && submodule)
        step(file ? link(submodule.title, submoduleTarget(section, submodule)) : el('span', submodule.title));
      if (file) step(symbol ? link(file.relPath, hash('file', file.id)) : el('span', file.relPath));
      if (symbol) step(el('span', symbol.name));
      if (diagram) step(el('span', diagram.title));
      const body = file
        ? renderFile(file, symbol?.id, range)
        : diagram
          ? renderDiagram(diagram, true)
          : section && submodule
            ? renderSubmodule(section, submodule)
            : section
              ? renderSection(section)
              : renderHome();
      reader.replaceChildren(body);
      document.title = [file?.relPath || diagram?.title || submodule?.title || section?.title, model.title]
        .filter(Boolean)
        .join(' · ');
      window.scrollTo(0, 0);
    }
    window.addEventListener('hashchange', show);
    show();
  }

  mount();
})();
