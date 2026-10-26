import { describe, expect, it } from 'vitest';
import { htmlToMarkdown } from './office.markdown.ts';

describe('Word 正文转 Markdown', () => {
  it('标题、强调、链接、列表与嵌套列表', () => {
    const { markdown, counts } = htmlToMarkdown(
      '<h1>导出</h1><p>只含<strong>订单</strong>，<em>不含</em>退款，见<a href="https://e.com/a?b=1&amp;c=2">规格</a>' +
        '<a id="_Toc1"></a>与<a href="#_Toc1">目录</a>。</p>' +
        '<ul><li>筛选<ol><li>按日期</li><li>按区域</li></ol></li><li>导出</li></ul>',
    );
    expect(markdown).toBe(
      [
        '# 导出',
        '只含**订单**，*不含*退款，见[规格](https://e.com/a?b=1&c=2)与目录。',
        '- 筛选\n  1. 按日期\n  2. 按区域\n- 导出',
      ].join('\n\n'),
    );
    expect(counts).toEqual({ headings: 1, tables: 0, images: 0 });
  });

  it('表格的第一行作表头，合并单元格展开到它覆盖的每一格，单元格里的竖线被转义', () => {
    const { markdown, counts } = htmlToMarkdown(
      '<table><tr><td colspan="2"><p>区域</p></td><td><p>金额</p></td></tr>' +
        '<tr><td rowspan="2"><p>华东</p></td><td><p>上海</p></td><td><p>1 | 2</p></td></tr>' +
        '<tr><td><p>杭州</p><p>西湖</p></td><td><p>3</p></td></tr></table>',
    );
    expect(markdown).toBe(
      ['| 区域 | 区域 | 金额 |', '| --- | --- | --- |', '| 华东 | 上海 | 1 \\| 2 |', '| 华东 | 杭州 西湖 | 3 |'].join(
        '\n',
      ),
    );
    expect(counts.tables).toBe(1);
  });

  it('图片按出现顺序编号，用替代文字说明，没有时写「无说明」', () => {
    const { markdown, counts } = htmlToMarkdown('<p><img src="" alt="导出按钮" /></p><p>后文<img src="" /></p>');
    expect(markdown).toBe('[图片 1：导出按钮]\n\n后文[图片 2：无说明]');
    expect(counts.images).toBe(2);
  });
});
