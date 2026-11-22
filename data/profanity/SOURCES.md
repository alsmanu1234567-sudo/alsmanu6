# Built-in profanity list attribution

These lists may include ambiguous words and are not a contextual classifier.

- Arabic: adapted from UXBERT's Arabic profanity dictionary, commit `15f64b425d0f34c0be3e3809f5eb0002eaf6e723`: https://github.com/uxbertlabs/arabic_bad_dirty_word_filter_list . Copyright (c) 2017 UXBERT. MIT licence in UXBERT-LICENSE.txt. Standalone ordinary family words were excluded; additional Arabic forms were added independently.
- English: derived from Titus Wormer's `cuss` map, commit `6bab3fef250481e34ba55bc400fac5c6d25f1429`: https://github.com/words/cuss . Copyright (c) 2016 Titus Wormer. MIT licence in CUSS-LICENSE.txt. Entries rated 2 are used, plus a small selection of common terms rated 1.

The Arabic Alastor WhatsApp bot (https://github.com/aranmr04-bot/alastor-altrost-) was inspected for its moderation approach. It is AGPL-3.0; no code or list was copied from it.
- Additional Arabic: selected explicitly vulgar entries from Dark Star's automatically generated Arabic list, commit `168f5b6c35ea04cb0eb0b2dc8d3d10339cc18084`: https://github.com/darkstarworks/bad-words-list . MIT licence in DARKSTAR-LICENSE.txt. The source warns that its list may contain words unsuitable for blocking; broad ambiguous terms were not imported wholesale.
