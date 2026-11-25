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
    return target === undefined ? el('code', label) : link(label, hash('file', target.id), 'source-link');
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

  function renderBlock(block) {
    if (block.type === 'diagram_ref') {
      const diagram = diagramById.get(block.diagramId);
      return diagram === undefined ? null : renderDiagram(diagram, false);
    }
    const area = el('section', undefined, 'content-block');
    if (block.title) area.append(el('h2', block.title));
    if (block.type === 'markdown') {
      area.append(markdown(block.markdown));
      if (block.evidence && block.evidence.length > 0) area.append(evidenceList(block.evidence));
    } else if (block.type === 'table') {
      area.append(table(block.columns, block.rows, block.caption));
    } else if (block.type === 'code') {
      area.append(pathLink(block.relPath, block.lineStart, block.lineEnd));
      const pre = el('pre');
      const code = el('code');
      for (const [index, line] of block.code.split('\n').entries()) {
        const row = el('span', undefined, 'code-line');
        const number = el('span', String(block.lineStart + index), 'code-number');
        number.setAttribute('aria-hidden', 'true');
        row.append(number, line);
        code.append(row);
      }
      pre.append(code);
      area.append(pre);
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

  function architectureCards(section, files) {
    const modules =
      section.kind === 'overview' || section.kind === 'architecture'
        ? model.sections.filter((candidate) => candidate.kind === 'module')
        : [];
    if (modules.length + files.length === 0) return null;
    const area = el('section', undefined, 'architecture-cards');
    const grid = el('div', undefined, 'architecture-card-grid');
    const cards = [
      ...modules.map((module) => [sectionLink(module), module.summary]),
      ...files.map((file) => [link(file.relPath, hash('file', file.id)), file.responsibility]),
    ];
    for (const [card, description] of cards) {
      card.className = 'architecture-card';
      if (description) card.append(el('span', description, 'muted'));
      grid.append(card);
    }
    area.append(el('h2', C.architectureCards), grid);
    return area;
  }

  function renderSection(section) {
    const content = el('article');
    content.append(el('h1', section.title));
    const graphs = model.diagrams.filter(({ sectionId }) => sectionId === section.id);
    const files = model.files.filter(({ sectionId }) => sectionId === section.id);
    const architecture = model.layoutStyle === 'arch';
    const rendered = new Set();
    if (architecture) {
      for (const graph of graphs) {
        content.append(renderDiagram(graph, false));
        rendered.add(graph.id);
      }
      const cards = architectureCards(section, files);
      if (cards !== null) content.append(cards);
    }
    if (section.summary) content.append(el('p', section.summary, 'summary'));
    for (const block of section.blocks) {
      if (block.type === 'diagram_ref') {
        if (rendered.has(block.diagramId)) continue;
        rendered.add(block.diagramId);
      }
      const body = renderBlock(block);
      if (body !== null) content.append(body);
    }
    const extraGraphs = graphs.filter(({ id }) => !rendered.has(id));
    if (extraGraphs.length > 0) content.append(linkList(C.relatedDiagrams, extraGraphs.map(graphLink)));
    if (!architecture && files.length > 0)
      content.append(
        linkList(
          C.relatedFiles,
          files.map((file) => link(file.relPath, hash('file', file.id))),
        ),
      );
    return content;
  }

  function renderFile(file, currentSymbol) {
    const content = el('article');
    content.append(el('h1', file.relPath, 'file-title'));
    content.append(button(C.copyPath, () => copyPath(file.relPath)));
    if (file.responsibility) content.append(el('p', file.responsibility, 'summary'));
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
        requestAnimationFrame(() => section.scrollIntoView({ block: 'center' }));
      }
      content.append(section);
    }
    return content;
  }

  function nodeTarget(node) {
    if (node.targetKind === 'section' || node.targetKind === 'module') {
      if (sectionById.has(node.targetId)) return hash('section', node.targetId);
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
    controls.append(
      button('＋', () => zoom(0.8), C.zoomIn),
      button('−', () => zoom(1.25), C.zoomOut),
      button(
        C.fitShort,
        () => {
          Object.assign(view, area);
          refresh();
        },
        C.fit,
      ),
    );
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
      toggle(control, evidence) {
        const same = active === control;
        clear();
        if (same) return;
        active = control;
        active.setAttribute('aria-pressed', 'true');
        panel.replaceChildren(el('strong', C.edgeEvidence), evidence.cloneNode(true));
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
    graphNavigation(canvas, controls, width, height);
    return canvas;
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

  function populateNav(navigation) {
    for (const section of model.sections) {
      const heading = sectionLink(section);
      heading.className = 'chapter-link';
      navigation.append(heading);
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
      for (const file of model.files.filter(({ sectionId }) => sectionId === section.id)) {
        const item = el('li');
        const a = link(file.relPath, hash('file', file.id));
        item.append(a);
        children.append(item);
        indexItem(a.getAttribute('href'), file.relPath, file.responsibility);
        for (const symbol of file.symbols) {
          indexItem(hash('file', file.id, symbol.id), symbol.qualifiedName, symbol.name, file.relPath, symbol.summary);
        }
      }
      if (children.childElementCount > 0) navigation.append(children);
    }
  }

  function renderSearch(query, navigation, results) {
    const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    results.hidden = terms.length === 0;
    navigation.hidden = !results.hidden;
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
    for (const a of site.querySelectorAll('aside a')) {
      if (a.getAttribute('href') === activeHash) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
  }

  function mount() {
    const sidebar = el('aside');
    const title = el('p', model.title, 'site-title');
    const label = el('label', C.searchLabel, 'search-label');
    const input = el('input');
    input.type = 'search';
    input.placeholder = C.searchPlaceholder;
    label.append(input);
    const navigation = el('nav');
    navigation.setAttribute('aria-label', C.outline);
    populateNav(navigation);
    const results = el('div', undefined, 'search-results');
    results.hidden = true;
    input.addEventListener('input', () => renderSearch(input.value, navigation, results));
    sidebar.append(title, label, navigation, results);

    const main = el('main');
    const breadcrumb = el('nav', undefined, 'breadcrumbs');
    breadcrumb.setAttribute('aria-label', C.breadcrumbs);
    const reader = el('div');
    main.append(breadcrumb, reader);
    site.append(sidebar, main);

    function show() {
      const [kind, id, symbolId] = route();
      const file = kind === 'file' ? fileById.get(id) : undefined;
      const diagram = kind === 'diagram' ? diagramById.get(id) : undefined;
      const section = sectionById.get(file?.sectionId || diagram?.sectionId || id) || model.sections[0];
      const current = file
        ? hash('file', file.id, ...(symbolId === undefined ? [] : [symbolId]))
        : diagram
          ? hash('diagram', diagram.id)
          : hash('section', section.id);
      activeHash = current;
      setActiveLinks();
      const home = link(model.title, hash('section', model.sections[0].id));
      breadcrumb.replaceChildren(
        home,
        el('span', '›'),
        file || diagram ? sectionLink(section) : el('span', section.title),
      );
      if (file || diagram) breadcrumb.append(el('span', '›'), el('span', file?.relPath || diagram.title));
      const body = file ? renderFile(file, symbolId) : diagram ? renderDiagram(diagram, true) : renderSection(section);
      reader.replaceChildren(body);
      document.title = `${file?.relPath || diagram?.title || section.title} · ${model.title}`;
      window.scrollTo(0, 0);
    }
    window.addEventListener('hashchange', show);
    show();
  }

  document.documentElement.dataset.theme = model.theme;
  mount();
})();
