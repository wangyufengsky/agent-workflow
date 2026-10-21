## Now: make these pages

{{pages}}

Each page's title and points are what the user confirmed; write the page's content from them, in its layout (you may pick another layout when the content fits it better). The layouts and their fields:

{{layouts}}

Call `agent-workflow_submit_slide` once per page, in page order, with its `page` number, its `content` and its speaker `notes`. Submit each page as soon as it is written, so the user sees it appear. The work is finished when the tool reports no remaining pages; then end your turn.
