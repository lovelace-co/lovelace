# Tone of voice and language

One standard for everything a person reads: documentation, UI strings, button and menu labels, empty states, error and validation messages, commit messages, and release notes. Whether one person writes it or ten, the voice must read as a single hand.

Everything in this guide is fixed except one variable: the **English variant**, which is set per project. Choose it once, then write every surface in it. This project's variant is **Australian English**. Adaca's playbook is UK English; an American project would set US English. Only the spelling and punctuation conventions in the next section change with the variant. Nothing else in this guide does.

## English variant (the one adaptive rule)

Declare the variant in the project's root instructions and hold it on every surface. Where a project has not declared one, default to the variant of its owning organisation.

- **Australian and British English** (this project): `-ise`, not `-ize` (organise, initialise, optimise, prioritise); `-our` (colour, behaviour, favour); `-re` (centre, metre); `licence` and `practice` for the noun, `license` and `practise` for the verb; a doubled l (labelled, cancelled, travelling); `catalogue`, `dialogue`, `analyse`. Two words: `time zone` and `long term` (unhyphenated). Australian usage keeps `program` for software.
- **American English**: `-ize` (organize), `-or` (color), `-er` (center); `license` and `practice` for both noun and verb; a single l (labeled, canceling, traveling); `catalog`, `dialog`, `analyze`.
- **Dates and numbers follow the reader's locale, never a hard-coded format.** In prose, write the month by name so the order is never ambiguous (9 June 2026, not 9/6 or 6/9). In the product, render dates and times through the operating system locale.

A variant is a whole-surface commitment. Do not mix `organise` and `organize` in the same project, even across files.

## Shared rules (every variant)

- **No em dashes.** Anywhere: prose, comments, UI strings, error messages. Use a comma, a colon, or a full stop. A pair of em dashes becomes a pair of commas or a set of brackets.
- **Plain, declarative, concise.** Say the thing directly. No marketing language, no buzzword salad, no hedging. State a limit as a fact ("this cannot be undone"), not as an apology. Let specifics and numbers carry the weight rather than adjectives.
- **Cut filler.** If a line is commentary about the work rather than something the reader can use, remove it. Do not restate what the reader already knows to fill space.
- **Plain English over jargon.** Prefer the word a user already understands. Say "active" and "complete", not "wip" or "terminal"; say "move", not "transition", where a person is reading. Keep internal vocabulary on internal surfaces.
- **Never show a raw machine identifier to a person.** Lowercase machine names (`in_progress`, `id_prefix`) are for files and code. Display a human label, defaulting to Title Case of the machine name. Align numbers with tabular figures, not by switching to a monospace font.
- **Bullets are a delivery aid, not a default.** Use prose for a single cohesive thought or a clean statement. Use a list only when there are two or more distinct beats the reader takes in sequence. A one-item list is a sentence.
- **Match the register to the surface.** Documentation *informs*: it builds understanding and carries no interface instructions. Interface copy *instructs*: it is the words on the control, short and in the reader's own terms, and it carries no background the documentation already gave. A doc that says "click the blue button" or a button labelled with a full paragraph is a register leak. Keep the layers apart.
- **One term, one meaning, everywhere.** A status, field, or action has a single name, reused identically across every screen and document. Before renaming a concept in one place, sweep the others so the vocabulary never drifts.
- **Errors point, they do not blame.** A validation or failure message names what is wrong and where (the file and line, or the field), in plain language, and then stops. No stack-trace tone, no cheerfulness, no "oops".

## Voice, in one line

Calm, exact, and quiet. Write as though the reader is competent and busy: give them the fact, in their spelling, and get out of the way.
