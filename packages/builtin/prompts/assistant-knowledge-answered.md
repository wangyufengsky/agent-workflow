The knowledge researcher answered the question you asked for the user (knowledge conversation {{conversationId}}).

Question: {{question}}

## Answer (its [n] markers refer to the citations below)

{{answer}}

## Citations

{{citations}}

The conversation's page is {{pageLink}} (or `open_page` with page `knowledge_conversation` and `knowledgeConversationId` {{conversationId}}).

Tell the user the answer in a few sentences, from this message alone: do not call tools for it (no knowledge lookup, no page, no skill); the user asks for more if they want it. Write each citation you mention as a Markdown link whose text is its number in brackets, exactly with the link given above, like [[1]]({{exampleLink}}): the user opens the cited source by clicking it. End with a link to the conversation page, like [在知识问答中查看]({{pageLink}}).
