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

  function evidenceList(evidence, source = pathLink) {
    const list = el('ul', undefined, 'evidence');
    for (const item of evidence) {
      const li = el('li', item.evidenceClass === 'static' ? `${C.sourceEvidence} · ` : `${C.inference} · `);
      li.append(item.evidenceClass === 'static' ? source(item.relPath, item.lineStart, item.lineEnd) : item.rationale);
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

  function sourceExcerpts(path, focus, citedRangeOnly = false) {
    const excerpts = model.sections.flatMap(({ blocks }) =>
      blocks.filter((block) => block.type === 'code' && block.relPath === path),
    );
    const area = el('section', undefined, 'source-excerpts');
    area.append(el('h2', C.sourceExcerpts));
    const found =
      focus === undefined || excerpts.some((block) => block.lineStart <= focus.end && block.lineEnd >= focus.start);
    if (excerpts.length === 0 || !found) area.append(el('p', C.noExcerpt, 'muted'));
    const shown =
      citedRangeOnly && focus
        ? excerpts.filter((block) => block.lineStart <= focus.end && block.lineEnd >= focus.start)
        : excerpts;
    const distinct = new Map(shown.map((block) => [`${block.lineStart}:${block.lineEnd}`, block]));
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

  function transactionCatalog(showHome) {
    const labels = C.transactions;
    const area = el('section', undefined, 'tx-reader');
    const directory = el('div', undefined, 'tx-catalog');
    area.setAttribute('aria-label', labels.catalog);
    directory.append(el('h2', labels.catalog));
    const references = el('section', undefined, 'tx-files');
    const preview = el('div');
    area.append(directory, references);
    references.hidden = true;
    const filter = el('input');
    filter.type = 'search';
    filter.placeholder = labels.filter;
    filter.setAttribute('aria-label', labels.filter);
    const listing = el('div');
    filter.className = 'tx-filter';
    let selected;
    let displayed;
    function fill() {
      const terms = filter.value.trim().toLocaleLowerCase().split(/\s+/);
      const visible = profiles.filter(({ title, code, channel, version, scenario }) => {
        const values = [title, code, channel, version, scenario].join(' ').toLocaleLowerCase();
        return terms.every((term) => values.includes(term));
      });
      const active = visible.find(({ diagramId }) => diagramId === selected) ?? visible[0];
      if (!active) {
        displayed = undefined;
        references.hidden = true;
        preview.replaceChildren();
        listing.setAttribute('role', 'status');
        listing.replaceChildren(el('p', profiles.length ? labels.noMatch : labels.empty, 'tx-empty'));
        return;
      }
      listing.removeAttribute('role');
      const list = el('ul', undefined, 'tx-list');
      for (const entry of visible) {
        const select = button('', () => {
          selected = entry.diagramId;
          fill();
          showHome(true);
          listing.querySelector('[aria-pressed="true"]').focus();
        });
        select.setAttribute('aria-pressed', String(active === entry));
        select.append(el('strong', entry.title));
        if (entry.code) select.append(el('code', entry.code));
        if (entry.channel || entry.version)
          select.append(el('small', [entry.channel, entry.version].filter(Boolean).join(' · ')));
        const row = el('li');
        row.append(select);
        list.append(row);
      }
      listing.replaceChildren(list);
      if (displayed !== active) {
        const diagram = diagramById.get(active.diagramId);
        preview.replaceChildren(renderTransaction(diagram, active, true));
        const paths = diagram.presentation.sourcePaths;
        references.replaceChildren(el('h3', labels.referencedFiles));
        for (const path of paths) references.append(excerptButton(path));
        references.hidden = !paths.length;
        displayed = active;
      }
    }
    filter.addEventListener('input', () => {
      fill();
      showHome(false);
    });
    directory.append(filter, listing);
    fill();
    return {
      area,
      preview,
      open(id) {
        if (displayed?.diagramId === id) return;
        selected = id;
        filter.value = '';
        fill();
      },
    };
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
    if (cards !== null) home.append(cards);
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
    content.append(sourceExcerpts(file.relPath, selection));
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
    if ('source' in node) {
      const source = node.source;
      if (source === null || !fileById.has(source.fileId)) return undefined;
      return hash('file', source.fileId, ...(source.symbolId ? [source.symbolId] : []));
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

  function graphNavigation(element, controls, width, height, firstBox) {
    const area = { x: 0, y: 0, width, height };
    const view = { ...area };
    let automaticFit;
    let anchor = firstBox;
    const refresh = () => element.setAttribute('viewBox', [view.x, view.y, view.width, view.height].join(' '));
    const zoom = (factor) => {
      automaticFit?.disconnect();
      const width = Math.max(area.width / 8, Math.min(area.width * 3, view.width * factor));
      const height = (width * view.height) / view.width;
      view.x += (view.width - width) / 2;
      view.y += (view.height - height) / 2;
      view.width = width;
      view.height = height;
      refresh();
    };
    const reset = () => {
      automaticFit?.disconnect();
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
        automaticFit?.disconnect();
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
      automaticFit?.disconnect();
      const scale = Math.max(view.width / size.width, view.height / size.height);
      view.x -= (event.clientX - drag.x) * scale;
      view.y -= (event.clientY - drag.y) * scale;
      Object.assign(drag, { x: event.clientX, y: event.clientY });
      refresh();
    });
    element.addEventListener('lostpointercapture', () => {
      drag = undefined;
    });
    function reveal(box) {
      anchor = box;
      if (box.x < view.x || box.x + box.width > view.x + view.width)
        view.x = Math.max(0, Math.min(area.width - view.width, box.x + (box.width - view.width) / 2));
      if (box.y < view.y || box.y + box.height > view.y + view.height)
        view.y = Math.max(0, Math.min(area.height - view.height, box.y + (box.height - view.height) / 2));
      refresh();
    }
    refresh();
    if (firstBox) {
      automaticFit = new ResizeObserver(([{ contentRect: size }]) => {
        if (!size.width || !size.height) return;
        Object.assign(view, area);
        if (Math.min(size.width / width, size.height / height) < 0.55) {
          // 小窗口或大型链路从可读比例开始；用户缩放和平移后保留其视口。
          view.width = Math.min(width, size.width / 0.85);
          view.height = Math.min(height, size.height / 0.85);
        }
        reveal(anchor);
      });
      automaticFit.observe(element);
    }
    return reveal;
  }

  function edgeEvidence(edge, nodes, source = pathLink) {
    const kind = edge.evidenceClass === 'static' ? C.static : C.inference;
    const label = edge.label || edge.kind;
    const endpoint = (id) => {
      const node = nodes.get(id);
      if (node === undefined) return id;
      const target = nodeTarget(node);
      return target === undefined ? (node.title ?? node.label) : link(node.title ?? node.label, target);
    };
    const content = document.createDocumentFragment();
    content.append(endpoint(edge.from), ` → ${label} → `, endpoint(edge.to), el('span', kind, 'evidence-tag'));
    if (edge.evidencePath) content.append(' ', source(edge.evidencePath, edge.lineStart, edge.lineEnd));
    if (edge.rationale) content.append(el('p', edge.rationale, 'muted'));
    const name = `${nodes.get(edge.from)?.label ?? edge.from} → ${label} → ${nodes.get(edge.to)?.label ?? edge.to} · ${kind}`;
    return { content, name };
  }

  function graphInspector(id, restore) {
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
    function select(control, content, label) {
      clear();
      active = control;
      active.setAttribute('aria-pressed', 'true');
      panel.setAttribute('aria-label', label);
      panel.replaceChildren(content);
      panel.hidden = false;
    }
    const dismiss = restore ?? clear;
    return {
      panel,
      clear: dismiss,
      select,
      toggle(control, evidence, label = C.edgeEvidence) {
        if (active === control) {
          dismiss();
          return;
        }
        const content = document.createDocumentFragment();
        content.append(el('strong', label), evidence);
        select(control, content, label);
      },
    };
  }

  function graphicAction(control, activate, clear) {
    control.addEventListener('click', activate);
    control.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        activate();
      }
      if (event.key === 'Escape') clear();
    });
  }

  function graphEdge(route, edge, markerId, nodes, inspector, role) {
    const showEvidence = () => edgeEvidence(edge, nodes, role ? excerptButton : pathLink);
    const evidence = showEvidence();
    const control = svg('g', {
      role: 'button',
      tabindex: 0,
      'aria-label': evidence.name,
      'aria-controls': inspector.panel.id,
      'aria-pressed': 'false',
      class: 'graph-edge-target',
    });
    if (role) control.dataset.kind = role;
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
    const label = edge.label ?? edge.kind;
    if (role && label) {
      const caption = svg('foreignObject', {
        x: route.labelX - route.labelWidth / 2,
        y: route.labelY - 20,
        width: route.labelWidth,
        height: 19,
        class: 'tx-edge-caption',
      });
      caption.append(el('span', label));
      control.append(caption);
    }
    graphicAction(control, () => inspector.toggle(control, showEvidence().content), inspector.clear);
    return control;
  }

  function graphSvg(diagram, nodes, width, height, controls, serial, inspector, transaction) {
    const canvas = svg('svg', { role: 'group', 'aria-label': diagram.title, class: 'graph-canvas' });
    const markerId = `arrow-${serial}`;
    const defs = svg('defs');
    const arrow = svg('marker', { id: markerId, markerWidth: 8, markerHeight: 8, refX: 8, refY: 4, orient: 'auto' });
    arrow.append(svg('path', { d: 'M 0 0 L 8 4 L 0 8 Z', class: 'arrow' }));
    defs.append(arrow);
    if (transaction) {
      const exception = arrow.cloneNode(true);
      exception.id = `${markerId}-exception`;
      exception.firstChild.setAttribute('class', 'tx-exception-arrow');
      defs.append(exception);
    }
    canvas.append(defs);
    const edges = new Map(diagram.edges.map((edge) => [edge.id, edge]));
    for (const route of diagram.layout.routes) {
      const edge = edges.get(route.id);
      if (edge !== undefined) {
        const role = transaction?.edgeRoles.get(edge.id);
        const marker = role === 'exception' ? `${markerId}-exception` : markerId;
        canvas.append(graphEdge(route, edge, marker, nodes, inspector, role));
      }
    }
    for (const { id, box } of diagram.layout.placed) {
      const node = nodes.get(id);
      if (node === undefined) continue;
      const target = nodeTarget(node);
      if (transaction) {
        const item = svg('g', {
          role: 'button',
          tabindex: 0,
          'aria-label': node.title,
          'aria-pressed': 'false',
          'aria-controls': inspector.panel.id,
          class: 'tx-graphic-node',
        });
        const title = svg('title');
        title.textContent = [node.label, node.summary].filter(Boolean).join(' · ');
        const slot = svg('foreignObject', box);
        const face = el('div', undefined, 'tx-node');
        face.dataset.kind = node.role;
        const icon = svg('svg', {
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          'stroke-width': 1.6,
          'aria-hidden': true,
        });
        const paths = {
          step: 'M4 5h6v6H4z M14 13h6v6h-6z M7 11v5h7',
          exception: 'M12 3 2 21h20Z M12 9v5 M12 16v2',
          external: 'M4 5h9v3 M4 5v14h14v-7 M11 13l9-9 M15 4h5v5',
        };
        icon.append(svg('path', { d: paths[node.role], 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
        face.append(icon, el('strong', node.title));
        if (node.detail) face.append(el('code', node.detail));
        slot.append(face);
        item.append(title, slot);
        transaction.buttons.set(id, item);
        item.addEventListener('focus', () => transaction.reveal(box));
        graphicAction(item, () => transaction.choose(id), inspector.clear);
        canvas.append(item);
        continue;
      }
      const item = target === undefined ? svg('g') : svg('a', { href: target, 'aria-label': node.label });
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
    const reveal = graphNavigation(
      canvas,
      controls,
      width,
      height,
      transaction && diagram.layout.placed.find(({ id }) => id === diagram.nodes[0].id).box,
    );
    if (transaction) transaction.reveal = reveal;
    return canvas;
  }

  function excerptButton(path, start, end) {
    const label = path + (start === undefined ? '' : `:${start}${end !== undefined && end !== start ? `–${end}` : ''}`);
    return button(label, () => {
      const dialog = el('dialog', undefined, 'tx-source-dialog');
      dialog.setAttribute('aria-label', path);
      const header = el('div', undefined, 'tx-toolbar');
      header.append(
        el('h2', path),
        button('×', () => dialog.close(), C.transactions.closeSource),
      );
      dialog.append(header, sourceExcerpts(path, start === undefined ? undefined : { start, end: end ?? start }, true));
      dialog.addEventListener('close', () => dialog.remove(), { once: true });
      site.append(dialog);
      dialog.showModal();
    });
  }

  function transactionTraces(profile, key, active, nodes, navigate) {
    const labels = C.transactions;
    const panel = el('section', undefined, 'tx-traces');
    const traces = profile[key] ?? [];
    panel.setAttribute('aria-label', labels[key]);
    if (!traces.length) panel.append(el('p', key === 'fields' ? labels.noFields : labels.noBoundaries, 'tx-empty'));
    for (const [index, trace] of traces.entries()) {
      const row = el('details', undefined, 'tx-trace');
      row.open = index === active;
      const summary = el('summary', trace.name);
      const chain = el('div', undefined, 'tx-chain');
      for (const id of trace.steps) {
        if (chain.childElementCount) chain.append(' → ');
        chain.append(button(nodes.get(id).title, () => navigate(id)));
      }
      const text = el('p');
      inline(text, trace.description);
      row.append(summary, chain, text, evidenceList(trace.evidence, excerptButton));
      panel.append(row);
    }
    return panel;
  }

  function transactionSources(paths) {
    const labels = C.transactions;
    const area = el('section', undefined, 'tx-sources');
    area.setAttribute('aria-label', labels.sources);
    if (!paths.length) area.append(el('p', labels.noSources, 'tx-empty'));
    for (const path of paths) {
      const entry = el('div', undefined, 'tx-detail');
      entry.append(excerptButton(path));
      const file = fileByPath.get(path);
      if (file?.responsibility) entry.append(el('p', file.responsibility));
      if (file) entry.append(link(labels.source, hash('file', file.id)));
      area.append(entry);
    }
    return area;
  }

  function renderTransaction(diagram, profile, standalone = false) {
    const labels = C.transactions;
    const article = el('section', undefined, 'tx-reader');
    article.setAttribute('aria-label', labels.flow);
    const header = el('header', undefined, 'tx-heading');
    const description = el('div');
    description.append(el(standalone ? 'h1' : 'h2', profile.title));
    const meta = [profile.code, profile.channel, profile.version].filter(Boolean);
    if (meta.length) description.append(el('small', meta.join(' · ')));
    if (profile.scenario) description.append(el('p', profile.scenario));
    header.append(description, link(labels.chapter, hash('section', profile.section.id)));
    const tabs = el('nav', undefined, 'tx-tabs');
    tabs.setAttribute('aria-label', profile.title);
    const panel = el('div');
    const flow = el('section');
    const graph = el('div', undefined, 'tx-graph');
    const toolbar = el('div', undefined, 'tx-toolbar');
    const controls = el('div', undefined, 'graph-controls');
    const size = labels.graphSize.replace('{nodes}', diagram.nodes.length).replace('{edges}', diagram.edges.length);
    const heading = el('h3');
    heading.append(standalone ? diagram.title : graphLink(diagram));
    toolbar.append(heading, el('small', size), controls);
    const nodes = new Map(diagram.nodes.map((node) => [node.id, { ...node }]));
    for (const display of diagram.presentation.nodes) Object.assign(nodes.get(display.id), display);
    const serial = ++diagramSerial;
    let selectedNode = diagram.nodes[0].id;
    const inspector = graphInspector(`transaction-inspector-${serial}`, () => hooks.choose(selectedNode));
    inspector.panel.className = 'tx-inspector';
    const hooks = {
      buttons: new Map(),
      edgeRoles: new Map(diagram.presentation.edges.map((edge) => [edge.id, edge.role])),
      choose(id, navigate = false) {
        selectedNode = id;
        const node = nodes.get(id);
        const control = hooks.buttons.get(id);
        const body = document.createDocumentFragment();
        body.append(el('small', labels.nodeDetails, 'tx-kicker'), el('h3', node.title));
        if (node.detail) body.append(el('code', node.detail, 'tx-method'));
        if (node.group) body.append(el('small', node.group));
        if (node.summary && node.summary.trim() !== node.title) body.append(el('p', node.summary));
        const target = nodeTarget(node);
        const source = el('div', undefined, 'tx-detail');
        const location = node.source;
        const path = location?.path ?? node.relPath;
        if (path || target) {
          source.append(el('h4', labels.sourceLocation));
          const file = location && fileById.get(location.fileId);
          const symbol = file?.symbols.find((entry) => entry.id === location.symbolId);
          if (path) source.append(excerptButton(path, symbol?.lineStart, symbol?.lineEnd));
          if (target) source.append(link(labels.source, target));
          body.append(source);
        }
        const fields = profile.fields ?? [];
        const related = el('div', undefined, 'tx-links');
        for (const [index, field] of fields.entries()) {
          if (field.steps.includes(id)) related.append(button(field.name, () => showTab('fields', index, true)));
        }
        if (related.childElementCount) {
          const group = el('div', undefined, 'tx-detail');
          group.append(el('h4', labels.relatedFields), related);
          body.append(group);
        }
        const outgoing = el('div', undefined, 'tx-links');
        for (const edge of diagram.edges.filter((edge) => edge.from === id)) {
          const next = button('', () => hooks.choose(edge.to, true));
          next.className = 'tx-next';
          next.append(el('strong', nodes.get(edge.to).title), el('small', edge.label ?? edge.kind));
          outgoing.append(next);
        }
        if (outgoing.childElementCount) {
          const group = el('div', undefined, 'tx-detail');
          group.append(el('h4', labels.outgoing), outgoing);
          body.append(group);
        }
        inspector.select(control, body, labels.steps);
        if (navigate) {
          const { box } = diagram.layout.placed.find((entry) => entry.id === id);
          hooks.reveal(box);
          control.focus({ preventScroll: true });
        }
      },
    };
    const canvas = graphSvg(
      diagram,
      nodes,
      diagram.layout.width,
      diagram.layout.height,
      controls,
      serial,
      inspector,
      hooks,
    );
    canvas.classList.add('tx-offline-canvas');
    const plot = el('div', undefined, 'tx-plot');
    plot.append(canvas);
    const legend = el('div', undefined, 'tx-legend');
    const entries = [['normal', labels.relations]];
    if (diagram.presentation.edges.some(({ role }) => role === 'exception'))
      entries.push(['exception', labels.exceptions]);
    if (diagram.presentation.nodes.some(({ role }) => role === 'external')) entries.push(['external', labels.external]);
    if (diagram.edges.some(({ evidenceClass }) => evidenceClass === 'inferred'))
      entries.push(['inferred', labels.inferred]);
    for (const [kind, label] of entries) {
      const item = el('span', label);
      item.dataset.kind = kind;
      legend.append(item);
    }
    graph.append(toolbar, plot, legend);
    const board = el('div', undefined, 'tx-board');
    board.append(graph, inspector.panel);
    flow.append(board, edgeList(diagram, nodes, excerptButton));
    const buttons = new Map();
    function showTab(view, active = 0, moveFocus = false) {
      for (const [key, control] of buttons) {
        if (key === view) control.setAttribute('aria-current', 'page');
        else control.removeAttribute('aria-current');
      }
      if (view === 'flow') panel.replaceChildren(flow);
      else if (view === 'sources') panel.replaceChildren(transactionSources(diagram.presentation.sourcePaths));
      else {
        panel.replaceChildren(
          transactionTraces(profile, view, active, nodes, (id) => {
            showTab('flow');
            hooks.choose(id, true);
          }),
        );
        if (moveFocus) panel.querySelector('details[open] > summary').focus();
      }
    }
    for (const view of ['flow', 'fields', 'boundaries', 'sources']) {
      const control = button(labels[view], () => showTab(view));
      buttons.set(view, control);
      tabs.append(control);
    }
    article.append(header, tabs, panel);
    showTab('flow');
    hooks.choose(selectedNode);
    return article;
  }

  function renderDiagram(diagram, standalone) {
    const profile = transactionGraphs.get(diagram.id);
    if (profile) return renderTransaction(diagram, profile, standalone);
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
    article.append(edgeList(diagram, nodes));
    return article;
  }

  function edgeList(diagram, nodes, source) {
    const details = el('details');
    details.append(el('summary', copy('edgeList', { count: diagram.edges.length })));
    const list = el('ul', undefined, 'edge-list');
    for (const edge of diagram.edges) {
      const item = el('li');
      item.append(edgeEvidence(edge, nodes, source).content);
      list.append(item);
    }
    details.append(list);
    return details;
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
        if (activeHash !== hash('home')) {
          for (let branch = a.closest('details'); branch !== null; branch = branch.parentElement.closest('details'))
            branch.open = true;
        }
      } else a.removeAttribute('aria-current');
    }
  }

  function mount() {
    if (model.transactionExplorer) site.classList.add('transaction-site');
    const sidebar = el('aside');
    const navigation = el('nav');
    navigation.setAttribute('aria-label', C.outline);
    populateNav(navigation);
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
    function closeOutline() {
      sidebar.classList.remove('outline-open');
      toggle.setAttribute('aria-expanded', 'false');
    }
    const catalog = model.transactionExplorer
      ? transactionCatalog((close) => {
          if (activeHash !== hash('home')) location.hash = hash('home');
          if (close) closeOutline();
        })
      : undefined;
    if (catalog) {
      const outline = el('details', undefined, 'tx-site-outline');
      outline.append(el('summary', C.outline), navigation);
      sidebar.append(catalog.area, outline);
    } else sidebar.append(el('p', C.outline, 'site-title'), navigation);
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
    const brand = link(C.pageTitle, hash('home'), 'site-brand');
    if (model.transactionExplorer) brand.prepend(el('strong', C.transactions.brand), ' / ');
    header.append(toggle, brand, search);

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
      if (catalog && diagram && transactionGraphs.has(diagram.id)) catalog.open(diagram.id);
      setActiveLinks();
      closeOutline();
      breadcrumb.hidden = catalog !== undefined && activeHash === hash('home');
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
          ? catalog && transactionGraphs.has(diagram.id)
            ? catalog.preview
            : renderDiagram(diagram, true)
          : section && submodule
            ? renderSubmodule(section, submodule)
            : section
              ? renderSection(section)
              : catalog
                ? catalog.preview
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
