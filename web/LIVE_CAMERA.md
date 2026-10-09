# Live camera

The live camera reads a printed puzzle held in front of the phone and draws the
recognised clues onto the same view, with a solution preview when the
transcription has exactly one solution. This document covers what it shows and
saves, how a handheld grid keeps its identity, what tracking costs, how changed
print is noticed, how the camera recovers, and how all of it is tested.

Every test named here uses simulated camera streams, controlled completions or
retained photographs. None is a physical-phone test: autofocus, exposure,
motion, installed-app behaviour, speed, memory and battery on real hardware
remain separate validation work, and no timing here is a measured phone
speed-up.

## What the camera shows

Open **Scan with camera** and hold the whole grid steady. While the camera aims
and reads, the screen shows the camera's own live video, which the browser
presents at the camera's rate whatever the page's scripts are doing. Over it
the camera's canvas is transparent and holds only the white outline of the
grid where the latest verified frame placed it, so during motion the outline
can trail the video by a verification. The outline is 2.5 CSS pixels wide with
a thin dark edge, so it shows on white paper whatever the frame's size (at the
frame's own scale it was under a CSS pixel on a phone). The clue numbers are
not drawn over the moving video, and a solution never is: the legend below the viewfinder counts
the reading instead (recognised, uncertain and unread clues), each count in
place of its colour's name ("14 · recognised"), so the legend and the
viewfinder above it keep their size whether counts show or not; the help line
says what the camera is doing, naming unread or uncertain clues by their
legend entry ("unread clue ?", "uncertain ?") rather than by a colour that is
not on screen, and the canvas's accessible label names the
outline and the counts, and says when the outline is catching up with the
camera. Before, the canvas covered the video with snapshots of it, 3 to 8 new
pictures a second, which looked like a slideshow. The camera stays open while
recognition and the local Python solver work in the background; the preview
needs no second board or confirmation dialog. **Read stable camera frames
automatically** can pause recognition; it never presses the shutter.

In the frozen and captured pictures, green numbers are recognised printed
values, yellow numbers with a question mark are uncertain readings, and a red
`?` is an unresolved cell, including a printed mark OCR could not read. Blue
numbers, and blue Slitherlink edges, are entries from a completed, unique
solution to the current transcription; only a frozen picture carries them.
Blank black cells are not answer slots, and a retained unread printed mark is
never painted over in blue. Red question marks are reserved for observed marks
that are unreadable, and solver output cannot hide them. Recognition can still
fail when the photograph holds too little visible evidence; the colours do not
guarantee a correct transcription.

Live solutions are **previews**, not confirmation that the photograph or the
inferred rules are right. Conflicting readings, incomplete structural data,
unread printed digits and nonunique results produce no blue answers; readings
flagged for review can take part in a labelled preview but stay yellow.
**Review captured clues** carries the inferred family and box settings and
every OCR warning into the editor, where Solve, Check and Hint still need the
usual confirmation. If the detected grid contradicts the selected rules (a
9 × 6 board while Sudoku is selected, a 12 × 12 Str8ts), the outline is shown
with the reason and no cell overlay is attempted until the type or the grid
settings change.

The camera waits for stable detections and reads the sharper sampled frame.
One recognition job and one preview solve run at a time, and a sampled frame is
released as soon as recognition has used it. Recognition has a 90-second
deadline, after which the camera can retry; the preview solver has a 90-second
runtime-loading deadline and an 8-second search budget, while the full editor
keeps its longer configurable budgets. Detection, recognition, tracking and
solving run in workers. Closing the camera, backgrounding the page, changing
settings or losing the stream cancels the matching work, and frames that are
never explicitly captured are never stored.

### The frozen solution and Clear

When a reading has a complete, unique solution on a verified frame, the camera
freezes the view: that frame stays on screen with its clues, the blue
solution, the outline and the PREVIEW bar, and the heading shows a **Frozen**
chip. Nothing moves or blinks any more, and **Save picture** stores exactly
that picture. The freeze paints the one camera frame the canvas shows while
the camera runs, on the frame the solution was verified on, never on a later
one; a solution that arrives while the grid does not verify freezes only once
a newer frame verifies it. It waits for a verified frame at most half a second
old, so the still does not jump back to a framing the user has left (a slow
phone spends much of its time on older frames), for at most three seconds from
the first render that shows the reading solved.

**Wait up to 3 s for clearer clues before freezing** (in Grid size &
settings, after automatic solving; off by default) adds a second wait within
the same three seconds: until no automatic retry of a yellow clue may still
change the reading. A retry needs a clearer frame of that clue, so with the
phone held still on one view, a reading with a retryable yellow clue then
freezes only after the full three seconds; with the setting off it freezes on
the first fresh verified frame, as before this wait existed, its yellow clue
flagged in the picture. In every measured run the wait only delayed the freeze,
so it is off until the comparison on the iPhone decides. The camera reads the
setting at every freeze decision and keeps it out of the reading's identity,
as it does automatic solving, so changing it while the camera runs applies to
the reading on screen and resets nothing. Without automatic solving nothing
freezes and the setting has no effect; it stays enabled, so it can be set
beforehand.

While the freeze waits, no solution is shown and the help line says "Solution
found — hold the grid steady for a moment…", from the moment the solved
reading is published, also when it returns after a blink. A reading that
freezes at the next render, a tenth of a second later at most, leaves the help
line as it stands until the frozen help replaces it. Save picture ends any
wait, freezing the view at once on the solution's own frame, whatever its age,
and saving that picture: no retry can run after the shutter. The three seconds
belong to the reading's own frame: a blink of the grid, a merged retry or a
new solve keep them running, and only a new full reading starts them again.

Freezing ends all frame work: no frame is sampled, and no detection,
tracking, OCR, retry or solve runs, while replies already in flight are fenced
and dropped. Before, a solved view kept sampling about four frames a second;
every measured blink of the solution, and both measured captures that missed
one (2 of 22 solved runs), happened in that phase.

The camera stays on while frozen, as the user chose: no timer turns it off, so
the camera indicator stays on and the phone does not lock itself while frozen
(WebKit keeps the display awake while a page captures). The video element is
paused behind the opaque still, which covers it exactly, and stays visible and
attached to its stream (WebKit gives a new player on an invisible video no
first frame, which would stall Clear after an app switch), and the
camera track stays live and enabled; Clear plays it again inside the tap, with
no new getUserMedia and no permission prompt. The page always plays the video
itself; the element has no `autoplay` attribute, for which WebKit shows its
native playback controls over the video while Low Power Mode is on. A paused
WebKit MediaStream
player keeps the frame it paused on for drawing while its count of presented
frames runs on, so the first video-frame callback after Clear could hand the
camera the picture of the freeze: the scheduler discards that first frame and
scans from the next. Detaching the stream at the freeze and attaching it
again on Clear would avoid that too, but WebKit (WebKitGTK in CI) left the new
player without a frame, so Clear timed out. Only
when the app is hidden (an app switch, the lock screen) or the system ends the
camera track is the camera turned off; the frozen picture, its reading and Save
picture stay, the help line says why and that the phone may ask for camera
access again, the action row holds just Save picture and Clear, and Clear asks
for the camera again inside its tap. A track the system only muted (another app
or a call holding the camera, Split View, system pressure) is kept, since a new
one would be muted as well: Clear says that another app or the system is using
the camera and finishes once the track unmutes.

**Clear** sits beside Save picture while the view is frozen. It plays the
video again inside the tap and only then discards the frozen picture and its
reading, so the still stays on screen until live frames can replace it. The
camera then scans from nothing: the same puzzle still in view is detected,
read and frozen again after about the usual time to a solution. The reading is
not kept, because a kept reading would freeze again on the next verified
frame; the warm OCR engine, the geometry worker and an idle Python interpreter
are. If playback is refused, interrupted (WebKit rejects play() while a call
holds the media session) or stays silent for eight seconds, the frozen view
stays and **Start preview** retries; on a phone held upright it takes a line of
its own above Save picture and Clear. A stream that plays but delivers no frame
for three seconds offers Start preview too, frames that arrive later take it
back (also after a failed retry), and the camera says when no picture has
arrived a second after Clear.
Start preview offered while the view is live never clears a solution that
freezes during its playback. If the camera cannot be turned back on, the frozen
view stays with the reason (a refused permission in plain words), and Save
picture still works.

Freezing has a price. A solution is not improved after the freeze: the
targeted retries of yellow clues end with it, and only with the freeze's wait
on do they get up to three seconds before it. A change on the paper is not
noticed until Clear, and a setting changed while frozen takes effect after
Clear. A unique solution built on a misread yellow clue freezes too: the
yellow flag stays in the picture and in review, and Clear reads the view again
from scratch.

### Warm workers

The page runs one Python interpreter. With automatic solving on, opening the
camera hands the page's idle or warming interpreter to the previews (otherwise
the previews load their own when the camera opens), and closing the camera
hands it back unless a preview search is running, which only termination can
stop. Solve after live scanning therefore starts without downloading and
starting Python again. Without automatic solving the camera takes no
interpreter, and the page's is released while the camera is open. The preview
runtime is warmed once per camera session and reloaded in the background after
a search budget had to terminate it. Realignment cancels an active search but
keeps an idle or warming worker; the first frame and settings changes do not
discard it. Warm-up failures and timeouts are retired, so later requests retry
without inheriting a broken worker.

Starting a Tesseract worker and loading its language data costs more than a
whole read on a phone, and the camera reads a scene several times, so each
Scanner keeps one OCR host and one geometry worker alive across reads. The
camera warms the OCR engine together with the preview solver when it opens.
Realignment cancels a pending read cooperatively, between recognition calls,
and keeps the engine (a stuck atomic call is replaced after two seconds);
closing the camera releases everything. Fresh pixel buffers are transferred
between workers rather than copied. The atlas pass finishes long before the
independent per-digit checks, so its readings are offered as a provisional,
fully review-flagged (yellow) preview that never starts a solve; only the
checked transcription does. A small in-memory cache reuses isolated readings
only for byte-identical crops read in the identical segmentation mode, never
for approximate matches, cell indices or solver answers; it holds at most 256
entries or two megabytes of keys and is cleared with the engine.

### Faint and dim printed marks

A low-resolution white digit on a black cell can be too dim for the fixed
white-pixel threshold: when that first mark detector finds no glyph, a bounded
local-contrast fallback looks for a substantial connected central mark.
Likewise, when the normal foreground threshold misses a white-cell digit, a
bounded local-contrast pass can keep it despite dark grid lines elsewhere in the
image. Flat black cells, empty cells, shallow texture, noise, gradients and
shading are excluded, with negative regression controls. Recovered glyphs stay
flagged even when the readers agree; plausible central ink without a usable
numeric component is carried as unread evidence rather than as a blank answer
slot; preprocessing never infers a numeric value.

The atlas, binary and grayscale readers are unchanged. When the two individual
readers disagree or miss a numeric crop, up to 24 crops per scan get one
raw-line (Tesseract PSM 13) retry; agreement already obtained on clean crops is
not disturbed, and large boards keep the existing grayscale budget. Retry
evidence votes only on the complete observed number, and rescued or changed
proposals stay flagged. No solved values, fixture answers or guessed
substitutions enter recognition. This is a bounded fallback, not a guarantee
for arbitrary photographs or handwriting.

## Shutter and saved pictures

**Save picture** stores an annotated camera frame, with the colour legend and
the PREVIEW label, and the panel then shows exactly the stored picture, whose
accessible label and counts then describe it ("Saved picture: 14 recognised,
…", or "Saved picture without a reading"). While
the solution is frozen it stores exactly the frozen picture, its frame and its
reading, also after the camera was turned off. A capture whose own
revalidation shows a solved reading freezes the view and stores the frozen
picture, also while the freeze waits for a fresher frame or a retry: the
help line has said that a solution was found, and the shutter stops the
camera, so no retry could follow. While live, the screen shows the video, so
the shutter chooses the frame. The reading's
corners and clues were proven on the latest verified frame only, so that frame
is kept, with its reading, outline and bar but without a solution (none was
shown), while it is at most half a second old and so matches what the user
saw; this gives **Review captured clues**. Otherwise the frame on screen at
the press is kept without a reading and goes to the editor's crop and read;
while no new frame has been presented for half a second ("Waiting for a new
camera frame"), the video may show nothing useful (iOS paints an interrupted
camera black), so the newest frame the camera scanned is kept instead. That
is the last adopted frame, unless a newer one was scanned since: while
nothing is verified (aiming, or once a found grid is lost) no frame is
adopted, and the frame each detection got for itself is kept once detection
is done with it; after a tracking failure, during whose back-off nothing is
sampled, the frame the worker failed on (for an anchor, the detection's
frame). The next adoption releases it.
Right after Clear the shutter instead says "Wait for a camera frame before
capturing." until a frame the video reported after Clear has been scanned:
the paused player can still draw the picture of the freeze (see Clear above),
which is why scanning discards that first frame too. Capture revalidates first, the coloured overlay is never fed back into OCR, and
capture never accepts the clues or rules for the user. The camera stops and
the picture stays on the same screen, also when the page is hidden meanwhile
(an app switch, the lock screen, a download prompt): only a live camera is
released on hide, and a captured still holds no camera. Escape closes the
camera panel like a dialog, also from the frozen view, and returns focus to
the Scan button.

The latest captured PNG is saved as exact bytes in this browser's IndexedDB,
also on WebKit backends that cannot store Blob objects, and appears under
**Last saved picture** after reload. **Download PNG** exports a separate copy;
**Delete saved picture** removes the browser copy. Web apps do not silently add
pictures to the system Photos library. Private mode, storage quotas and browser
eviction may prevent persistence; failures are shown and the in-memory picture
stays downloadable, so download important pictures separately. The shutter is
the only exception to the photo policy: imported photographs and uncaptured
live frames are neither persisted nor uploaded, and only one captured PNG is
kept, with no hidden camera history.

Saves and deletes take ownership when requested, before byte conversion or
database opening finishes, and a new capture replaces the previous one only
after its transaction succeeds. Every save or delete first requests an
origin-wide Web Lock. Under that short lock an IndexedDB transaction writes a
fresh ownership token, and a delete also removes the picture atomically; PNG
encoding and conversion run outside the lock and outside transactions, and a
save's final readwrite transaction checks the durable token before writing.
Older work, in this tab or another, therefore cannot resurrect a deleted
picture or overwrite a newer one, even when its conversion or database opening
finishes late, and ownership does not depend on timestamps or synchronized
clocks. The gallery reserves ownership at the shutter call, before
`canvas.toBlob`. Queue and database waits are bounded. Without cross-context
coordination, persistent mutations fail explicitly; scanning and PNG download
stay available, and an earlier saved picture is not silently removed. Messages
stay tied to their request, and a failed write keeps the existing saved image.

Database version 2 keeps the existing store and both old picture formats, and
stops still-open version-1 app code from reopening the database and writing
without the ownership checks; such an old app must reload before it can save
or delete again.

## Tracking a handheld grid

### Identity through motion

The camera registers bounded local image patches across the detected grid: at
most 25 patch features, an 8-pixel local search around where the anchor last
matched, and bounded deterministic robust fitting of a projective transform for
small translations, rotation and scale. Only then are the content checks below
applied. Registration is not identity: a fitted rectangle alone never
authorizes an overlay or captured metadata. Content sampling uses up to 1280
pixels; detection keeps its 640-pixel budget.

Each read stays anchored to its captured pixels, and verification compares with
that anchor, never with a chain of drifting successor frames; background pixels
and timers are not the authority for identifying the puzzle. One current-frame
verification cache is cleared on every camera tick. The fitted corners must
stay within 16 pixels of where the anchor last matched, so a grid that jumps
further cannot be found by verification alone. The next detection finds it:
when an anchor operation matches a retained anchor at the new detection, it
records where, and the following verifications search there, so the reading
re-locks instead of being lost after five seconds and read again.

OCR ownership is separate from display permission. Brief tracking loss hides
every entry and captured clue metadata without cancelling the read: its result
can finish off-screen and is queued, solving starts only after the exact sample
verifies again, and a late solver result stays hidden until reverified too.
Two mutually matching fresh detections of changed content retire the old job;
settings changes and Stop do so at once. Five seconds of unverified loss retire
retained work, and the 90-second OCR timeout still applies. A grid that was
never found is never lost: aimed at nothing, the session runs no loss clock,
so the help line carries only the detector's guidance. Before, the session
counted that as a loss: from two seconds on it wrote "Aligning the grid" and
every five seconds "Grid lost" to the help line, each replaced at once by the
detector's guidance in the same task, and recorded a grid-lost reset in the
diagnostics every five seconds. Time while the worker builds an anchor does
not count towards those five seconds, since no verification can arrive
meanwhile; before, an anchor of about seven seconds or more reset the
reference each time, so reading never started and the help line repeated
"Grid lost". Temporary captured-frame canvases are released on success,
failure, outdated detection, replacement and Stop.

### Background tracking and its cost

The live camera sends transferable pixels to `live-tracking-worker.js`, so
feature extraction, registration and content verification do not run on the
interface thread. There is one active operation, one replaceable latest video
frame and one pending detector-anchor request. Up to eight worker-owned anchors
are retained, with the current reading and reference anchors protected from
eviction, and the worker keeps grayscale evidence, not extra RGBA source copies.
Stop, settings changes and errors terminate the worker and fence its replies.
Each operation fails closed after its own deadline: two seconds for a
verification, twenty for an anchor. With one shared two-second deadline, every
anchor on a device whose verifications approach two seconds failed and ended in
Restart.

Verification cost grows with the anchors it checks, since each one is a
registration and a full content comparison. An anchor operation re-matches
every retained anchor, so the reference, the best frame and a challenger are
compared with each new detection there. A verification checks only the anchors
whose proofs are read: the reading's own anchor, the frame being read, a
pending candidate, and the guide while no preview is shown. A settled reading
therefore verifies one anchor per frame where it used to verify three or four.
Each operation computes the frame's grayscale and integral image once for all
its anchors. On six noisy real photographs in desktop Chromium at 960 and 1280
pixels (2026-09-24), a verification of one anchor takes 51-66 ms (63-79 ms
before these changes), and of three anchors 140-177 ms (194-244 ms). An anchor
with three retained anchors costs 1.1 to 1.2 times a verification of the same
three, and 19-27 ms to build alone. Earlier ratios of ten times (a synthetic
9x9 board) and 67-131 times (photographs) compared against verifying an
unchanged frame, which returns before registration and the content comparison.
Verifications wait while an anchor is built, and grid detection's own
eight-second deadline no longer covers anchoring. Manual capture remains
available without a synchronous registration fallback.

### Live and delayed views

Over the live video the camera draws only what a verification proved: the
outline of the grid in the latest adopted snapshot, in that snapshot's
coordinates. A snapshot is adopted only when a verification of it returns, so
while the camera aims at nothing none is (`adoptedFrame()` is null). The
canvas has the snapshot's size and letterboxes it in the
video's box like the video (both fill the viewfinder: the general 65vh cap on
videos, which made the video's box shorter than the canvas's on tablets and
desktop screens, does not apply), so those coordinates land on the video. The
canvas takes the touches, as it did when it showed snapshots: VoiceOver's touch
exploration finds its label there, and no touch reaches the video. The
outline is drawn only while the snapshot has the video's shape within half a
percent, so not between a rotation or a change of stream resolution and the
settings reset that follows, nor while the video has no size. The view
freezes only on such a snapshot too, since the paused video stays visible
behind the frozen still. A verification
result is never projected onto a newer frame: during motion the outline
trails the video by up to one verification. Verified evidence comes in two
tiers. It is live while the adopted snapshot is at most 500 milliseconds old.
Once one is older, the outline still follows it, marked as catching up in the
canvas's `data-delayed` attribute and its accessible label, so a device whose
tracking takes a second per frame gets a trailing outline rather than none.
`data-delayed` marks the tier of whatever verified evidence is shown, the
outline or the reading the legend counts, so also while a frame of another
shape leaves no outline to draw; with neither shown it marks nothing. It
returns to live only after snapshots have stayed within 500 milliseconds for
two seconds: with replies of 300-400 ms, or pauses while an anchor is built,
the age crosses 500 ms on every reply and the mark would otherwise flip with
it. The DELAYED label the snapshot display painted into its bar is gone: live
video is never delayed. A reply is adopted while its own snapshot is at most
two seconds old and newer than the last adopted one, also after an older
snapshot was dropped. A new detection waits until the pending candidate has
been verified or rejected, so with slow replies each candidate is verified
before the next replaces it, and reads and solves run on the delayed tier. A
snapshot older than two seconds is dropped with its proofs, which hides the
outline and the counts; the unverified copy of a newer frame that used to
replace it every two seconds is gone, since the video is the display. The
help line announces "Aligning the grid" only once the view has stayed
unverified for two seconds, because verified replies can arrive that far
apart; announcing every gap alternated it with the status six to eight times
every five seconds. A worker that never answers reaches the failure, backoff
and Restart path (see Recovery). Neither tier promises that image copying and
rendering are off-thread. A frozen solution is never marked as catching up: it
is the frame the solution was verified on, which the freeze takes at most half
a second old, or after its three-second wait at most two.

### Detection pacing

Grid detection starts every 300 ms, counted from the start of the previous
detection, while the grid is being acquired or re-found. Once a reading is
shown, or is running or finished while its own frame still verifies (the last
reply covering it, within four seconds, verified it rather than rejecting it),
a new detection only offers a sharper frame, clues to retry or a changed grid,
which the verification's content check notices as well. It then waits at least
a second after the previous candidate's verdict, and, when the last anchor took
more than 250 ms, three times that anchor's time plus the two-second settle:
the worker verifies nothing while it builds an anchor, and such an anchor ages
the view onto the delayed tier. Re-detecting every second from its start kept
the view DELAYED whenever anchors took half a second or more: with 30 ms
verifications and anchors of 0.5-2 s, the fake-clock simulation of the real
camera, tracker and tracking core showed the preview live 0% of the time, and
now 73-80%.

### Frame scheduling and painting

`live-frame-scheduler.js` follows newly presented video through one-shot
`requestVideoFrameCallback` calls where the browser has them; presentation
counts tell a genuinely new frame from a repeated one, including live streams
whose media timestamp is zero. Without native callbacks it falls back to
decoded-frame counts, then to an advancing media clock. A native callback that
has gone silent is abandoned only after a second without one and two
independent advances of the playback counters, with dropped frames subtracted;
a timer or the media clock alone cannot authorize the switch, and callbacks
from before the switch are fenced. Repeated starts and shutdown fence every old
callback.

Frames are processed at most every 100 ms, back off to 250 ms once a reading
is settled and up to 300 ms when recent worker timing calls for it; the
latest-frame queue stays bounded. Since the video is the display, a processed
frame is sampled (drawn from the video into a snapshot of at most 1600 pixels)
only for the pipeline's own work: to verify a pending candidate, the guide or
a reading, and once per detection. While the camera aims at no grid that is
one snapshot per detection, every 300 ms, which detection gets itself; no
tracking pixels are read back and no frame is adopted. Detection gets a copy
only of a frame that is verified too, since tracking adopts that snapshot.
Before, every processed frame was sampled, its 960 × 1280 tracking pixels
were read back and it was adopted after an empty verification, and each
detection drew one more copy: about eight snapshots and readbacks a second
while aiming with a 30-fps camera, which only the snapshot display had
needed. The tracking and detection canvases are sized only when the frames
change size: assigning a canvas its size again resets it (WebKit and
Chromium keep a bitmap of the same size, so that saves the reset, not an
allocation; the saving above comes from sampling less). Each draw clears its
bitmap first, as the reset did, so a frame that draws nothing (a video
without a picture) leaves no earlier frame's pixels to verify or detect.

A separate 100 ms heartbeat expires the overlay when presentation is over
500 ms old, or the accepted tracking evidence is older than the two-second
limit above, even if no video callback arrives, so a detector reply can never
sample a stalled video into fresh evidence; with nothing verified (no proofs,
reading or guide) it has nothing to expire, and a stalled feed is still
reported. Every heartbeat still validates freshness and the current solver
preferences, and decides the freeze, but the canvas is repainted only when
what it shows changes: whether an outline is drawn, the outline itself rounded
to half a pixel (so sub-pixel jitter of the proofs does not repaint), the
reading the counts describe, or the tier. A live paint clears the canvas and
strokes the outline, vector work only; no camera frame is drawn until the
freeze. These are processing intervals, not sensor frame rates: the browser
presents the video itself. While the view is frozen the scheduler is stopped:
no video-frame callback, heartbeat, snapshot or readback runs, and Clear
starts it again with new tokens, taking the first frame the video reports only
as a baseline (`discardFirst`), so the first frame scanned was presented after
the tap.

## Noticing changed print

No whole-frame thumbnail or motion fingerprint certifies clues; the camera
keeps none. The content comparison works on observed pixels from a
bounded-resolution copy of the frame, never on OCR output or solver answers.
Each cell has an area-sampled 24-by-24 signature of raw averages, including
white-on-black marks, and overlapping small label regions and full strips along
shared cell boundaries cover cage labels, walls and Futoshiki signs. Every
region must match independently. Structural strips keep their measured ink
contrast instead of stretching thin grid lines to black, and a smaller change
budget preserves small constraints without turning registration jitter into
constant rereading. Labels, inequality signs, cage edges and both ink
polarities all take part; unchanged solved scenes keep their battery-saving
backoff.

When two signatures are compared, the polarity and the contrast stretch come
from the reference region and apply to both, so they cannot flip between two
views of the same print; only the paper (or black) level follows each frame,
from the mean of a histogram band rather than a single percentile, which
absorbs a uniform illumination change. Light ink on a dark ground is assumed
only when the bright band clearly dominates. This anchoring replaced per-frame
normalisation after the comparison was first measured on real photographs, on
14 September 2026, and failed: each frame had chosen its own polarity and paper
level, so a blank strip of grey paper could flip between dark and light ink,
and a quarter-pixel shift, sensor-like noise or a six percent brightness change
read as changed print on five of six corpus photographs; a jittered newspaper
stream reset the live view twelve times in twenty-five seconds. Synthetic
boards alone cannot stand in for halftone paper.

Each region passes two tests. The high-contrast test counts samples that differ
by more than 64 levels at the best of the small shifts; when every shift fails,
the best raw registration alone is forgiven a tenth of the local contrast,
because a grid line thinner than the sample spacing cannot be interpolated to a
fractional shift, while a shift chosen merely to hide a change gets no
allowance, which keeps a small changed cage label visible. The low-contrast
residual test runs unblurred at the best raw registration only, so it cannot
pick another shift to hide weak ink behind a strong grid line; it allows sensor
noise, a bounded relative illumination change and a fraction of the local edge
contrast for sub-sample jitter, then requires even weak residual strokes to
agree. Identical and near-noise regions skip that work. It catches an 8
becoming a 3, or a 3 becoming an 8, down to print contrast 15 on a clean print,
and light strokes on a dark ground from about 45.

The residual test's noise floor is measured: 1.5 times the frame-to-frame noise
of the two regions compared (their median absolute difference at the chosen
registration, as a standard deviation), in the region's own units and never
below four levels, for the stretched cell interiors and the unstretched
structural strips alike. A clean print keeps the four-level floor; a grainy one
gets a floor that grows with its grain, so grain is not taken for a changed
clue, label, sign or wall. A fixed four-level floor in stretched units had
turned ordinary paper grain into changed content and blocked acquisition before
OCR started, and scaling it by the stretch (#73) raised it for every faint clean
print, missing an 8 becoming a 3 up to print contrast 80 and a 3 becoming an 8
up to 130. On synthetic 40-pixel cells, grain of ±4 to ±10 levels now produces
no false changes (#73: 7-17% at ±8 and ±10), a whole 9x9 board with ±8 grain at
30 pixels per cell stays unchanged (#73: 81% of pairs changed), and averaged
over that review's noisy sweep the 8/3 stroke is caught more often than under
#73. Heavy grain can still hide a faint stroke; detection falls as grain rises.

A mismatch takes the live session's invalidation path: pending recognition and
search are cancelled, provisional answers, delayed callbacks and captured
metadata are retired, and the new scene is read. Measured on paper photographs,
the comparison is robust to shifts of half a pixel at the 720-pixel working
size with noise and illumination change; at a full pixel one region in five can
still trip, and the whole-frame motion check retires the answer for larger
movement anyway. Photographs of screens (moiré) are not covered, and very small
or sub-noise marks remain heuristic.

## Recovery

### Reading again

Once a complete unique solution is shown, the view is frozen and nothing is
read again until Clear; before that, while the freeze waits (at most three
seconds, for a fresh frame or, with the setting for clearer clues on, for a
retry), targeted retries and a re-read of a much sharper frame can still run.
A complete reading without automatic solving is not read
again until the picture or the settings change, or autofocus yields a
substantially sharper frame. An unresolved scene retries with a doubling
interval (3, 6, 12, then 24 seconds), so an unreadable page does not keep OCR
busy. A sharpness gain of both 30 percent and 40 points may retry after one
second instead, also on a provisional solved scene, since improved focus is new
recognition evidence; small focus fluctuations do not restart OCR. Each retry
takes fresh pixels: a released frame is never eligible merely because it was
sharper, and frames observed while OCR was pending do not outrank the next fresh
capture.

A full re-read of a completed reading is a proposal until it finishes. The
completed reading stays in place, with its tracking anchor still verified, and
partial output from the re-read never replaces it. A re-read that completes
replaces it only once its own frame verifies, before it is shown or solved. One
that fails, is cancelled or reaches the 90-second deadline leaves the previous
reading and its solution in place and says "Keeping the previous reading";
callbacks it delivers afterwards are ignored. Changed content, prolonged loss,
settings changes and Stop still reset the reading as before.

### Targeted retries of uncertain clues

After a complete numeric reading, a substantially clearer cell interior can
trigger a targeted retry through `Scanner.readCells`. At most 12 uncertain,
marked numeric cells are sent to OCR, twice per cell at most, with a 1.5-second
minimum interval. Identical quality does not retrigger work; identical encoded
crops can skip OCR, and repeated evidence cannot vote. Warp and preparation
still run for the complete grid so the crop geometry is consistent, but the
atlas and independent numeric samples contain only the selected cells.
Structural cage and Kakuro targets keep the full-read and manual-review path.

The original reading anchor is never replaced by a chain of retries. A retry
must match the same rules and original content, and both original and retry
samples must be reverified before its results can apply. Confident or
explicitly confirmed clues are not replaced; absent marks cannot delete earlier
clues. Changed proposals remain uncertain and require review, and solver
answers do not participate. A failed or timed-out targeted read retires only
its own request: the preceding full reading and its source stay available, but
only current identity verification can authorize their display, and a late
reply cannot restore a retired scene or replace a newer retry. Each cell has two
automatic attempts; a request reserves an attempt before it starts, an explicit
identical-crop skip or a zero-OCR result refunds it, and an error or timeout
consumes it. Once every remaining cell is exhausted, the status line and the
diagnostics ask for manual review instead of promising another retry.

### Re-reading one clue in the editor

After **Review captured clues**, or a photo import, the editor's cell dialog
offers **Re-read this clue** for a clue that is still flagged uncertain, is
numeric, and whose cell matches the retained straightened photograph. It is not
offered in Play mode, for confirmed or confident clues, or for Kakuro, KenKen
and Killer puzzles, whose cage and sum targets keep the full-read path. The
re-read is a numeric-only `Scanner.readCells` call on the retained rectified
photograph; it shows OCR's proposal beside the field and changes nothing by
itself: **Use proposal** copies the number into the field, and the ordinary
**Save** confirms that one clue and stays undoable. Identical source pixels
reuse a cached proposal, up to eight per source, for crops of at most 65,536
pixels; new pixels cause a new read. A proposal belongs to the generation,
image, cell, source and photo signature that requested it and to an open dialog
with an unchanged draft: closing or reopening the editor, changing the source or
puzzle, or editing the field discards a late result, and a read that takes
longer than ninety seconds leaves the field as it was. The cache never promotes
confidence, and nothing comes from a solution.

### Tracking failures and Restart

A stalled grid detection has an eight-second deadline and retries while the
video stays active; a settings change cancels pending geometry work at once. A
tracking failure backs off for two seconds, then four; the third consecutive
failure stops automatic tracking and the camera offers **Restart live scanning**
(`tracking-recovery.js`), never while the solution is frozen. One successful
message does not clear the streak; two seconds of sustained verified work does.
Restart retires the prior work, fences its replies and starts the callbacks and
the worker again. Until then the shutter still captures the current frame by
hand, and readings the camera can no longer verify stay hidden rather than being
shown on the wrong frame. Start/Stop cycles reset the pipeline, a repeated Start
is idempotent, and retired detector clean-up or solver errors cannot cancel a
newer request. Stop releases the scratch canvases, the newest scanned frame
and any pending read samples as well as the timers and workers.

The tracking worker returns bounded rejection reasons (cell, structural region,
geometry or missing anchor), with numeric region indices only, never image
bytes. Three rejected candidates in a row surface an explicit alignment message
and Restart until a candidate verifies, or until detection reports no grid, a
timeout, an error or a grid that does not fit the rules and says so instead;
Save picture keeps the independent single-photo crop and read route. These
reasons help tell acquisition failures before OCR from OCR, rendering or worker
delay.

## Diagnostic timings

`scan-metrics.js` keeps bounded numeric windows of the latest 128 samples per
measurement: painting, the main-thread time of each sampled camera frame
(`performance.tick`, including the readbacks for detection and tracking it
starts; a tick that samples nothing is not counted), frame age, tracking
latency, queue work and the time to the first completed reading. Frame age
and tracking latency count the frames sent for verification; while the camera
aims at nothing none is. Before, every aiming frame counted too, through its
empty verification: only as old as its own readback, with the tracker's last
time repeated, so those medians were lower the longer the camera aimed at
nothing.
`performance.overlay` shares the live time while a grid is found and tracked
between its modes: the outline drawn, or nothing over the video (a rejected
or stalled proof, a tracking failure, a frame of another shape); aiming at
nothing, the frozen view and a closed camera do not count. The freeze, Clear
and a camera turned off while frozen are recorded as `frozen`, `cleared` and
`camera-released` events. P50 and P95
describe the window; means, maxima and counts describe the session. Render
requests are counted separately from actual paints, and repeated updates of one
frame do not double-count its tracking measurement. The export carries numbers
only, never images or free text. They are app timings, not sensor frame rates or
battery estimates.

## External pictures

`python scripts/fetch_live_fixtures.py` retrieves 12 hash-selected records from
the **test** split of Lexski/sudoku-image-recognition at revision 733559b. It
fails on revision changes, missing data and oversized files, and the selection
is made before running the scanner, not by keeping only pictures it can read.
The images stay untracked; reports keep the source revision, selection, file
hashes and every success and failure.

Source and attribution: Lexski (CC0),
https://huggingface.co/datasets/Lexski/sudoku-image-recognition

## Tests

Unit tests (`node --test web/tests/*.test.js`):

- `live-scanning.test.js`, `capture-store.test.js`, `ocr-retry.test.js`: colours,
  unread evidence, generation ownership, deadlines, transaction completion,
  unavailable storage and retry budgets; `capture-store` also covers transaction
  rollback, byte-storage round trips, same-context ordering and coordination
  failures.
- `live-latency.test.js`: retry ownership and scheduling. `live-content.test.js`:
  content-change boundaries; `capture-store.test.js`: deletion ordering.
- `live-registration.test.js`: small translations and rotation, background
  changes, and rejection of changed digits, erasure, fingers, weak labels and
  boundary marks. `live-interior-change.test.js`: small stroke changes in both
  polarities. `anchored-content.test.js`: the anchored polarity and the raw
  signature format.
- `live-retention.test.js`: pending and completed OCR, provisional results,
  changed-board ownership, bounded loss and shutdown.
- `live-delayed-tier.test.js`: the two tiers, detection pacing and slow anchors;
  `live-relock.test.js`: re-locking after a jump and one verified anchor per
  settled frame.
- `live-freeze.test.js`: the frozen solution on the production camera, tracker
  and tracking core with a fake clock: it freezes on its own verified frame
  (also inside a tick, which then samples no frame), and only on a
  verified unique solution, never on a provisional, multiple or unsolvable
  reading or without automatic solving; nothing is sampled, detected, tracked,
  read or painted while frozen: held replies and an abandoned detection are
  fenced without cancelling the geometry worker (its frame released, also
  when its reply comes after Clear), and the reading is retired
  (neither a frame it kept nor a re-read it began outlives the freeze), and
  the frozen time counts in no overlay mode;
  Restart is hidden, also when offered just before the freeze; the heartbeat
  that follows a freeze in the same pulse leaves the frozen help line alone;
  capture keeps the frozen frame and reading; Clear starts from nothing (a clean
  tracking circuit and fresh detection and lag clocks included), a camera
  started again is labelled live and counts nothing, and thirty Clear cycles
  leave no timer or canvas behind.
  `photo-flow.test.js` covers the page: the video paused but still attached and
  the camera kept on while frozen, with no timer to turn it off, Clear playing
  the same player inside its tap (loading nothing) before scanning resumes, and, on a
  video modelled on WebKit's player with the real frame scheduler, the first
  frame scanned after Clear presented after the tap; refused, interrupted,
  stalled and silent playback, Start preview's live retry when a solution
  freezes meanwhile, and its offer taken back when frames come, also after the
  retry itself failed; an app switch or an ended track turning the camera off
  without closing the panel (also while Clear waits for playback, whose
  interrupted play() then blames nothing), reported to the diagnostics, with a
  later app switch keeping the line that says why; getUserMedia again on Clear,
  called inside its tap, with a grant or failure that arrives after a close, a
  reopen or an app switch fenced; a muted track kept until it unmutes, the
  failure texts, and Escape and the shutter from the frozen view. `app.test.js`
  checks the Frozen chip's contrast and that the camera's video has no
  `autoplay` attribute.
- `live-overlay-view.test.js`: the live view on the production camera, tracker
  and tracking core with a fake clock, every canvas recording what is drawn
  into it, square frames and a phone's portrait 3:4 ones. While live the
  camera's canvas gets no camera frame, digit or solution, only a cleared
  layer with the outline: closed, white, 2.5 CSS pixels wide through the
  canvas's contain scale with a dark halo (a canvas not laid out, and the
  frozen picture, keep a 500th of the frame, at least two pixels), on the
  verified corners, following the candidate's
  current proof before a reading; a move along either axis or a zoom about a
  corner repaints it, sub-pixel jitter of the proofs does not. The freeze is
  the one camera-frame paint, timed like the others, and the frozen and
  captured pictures carry the clues, the solution (frozen only), the outline
  and the bar on its dark backing, on portrait frames too. `data-overlay`,
  the legend counts (the solution's only frozen) and the labels follow; no
  outline is drawn, and no solution frozen, on a frame of another shape (1 %
  off; 0.4 % is rounding), nor an outline over a video without one; the
  canvas takes the adopted frame's size (after a change of stream resolution
  with the first frame adopted on the new shape, which verifies the grid
  there), and is not resized while that size holds; the first frame adopted
  is the one that verified the candidate; past the stale limit the snapshot
  and its proofs are dropped and no copy takes their place; `data-delayed`
  follows the
  tier of the verified evidence shown, the outline or the reading the legend
  counts (also when a frame of another shape leaves no outline to draw), and
  marks nothing while neither is; a stalled feed
  with no adopted frame still offers Restart. The freeze
  waits for a fresh frame whatever the setting, and with the setting for
  clearer clues on for the retries of a marked yellow clue, for at most three
  seconds counted from the first solved render across a blink; a yellow clue
  no retry can read does not hold it, nor by default (the setting off) does a
  retryable one, which then freezes on the next render with nothing written to
  the help line. Turning the setting off during the wait freezes at the next
  render, and on during a wait for a fresh frame keeps the reading waiting for
  the retries, either way on the same reading, with nothing started over.
  While the freeze waits the help line holds only the wait's text, also across
  a blink, with the setting off as on (a reading that blinks while it waits
  for a fresh frame freezes on its return without the session's text for a
  solution on screen), and with the setting on a reading with nothing to retry
  is not held. A live capture keeps a
  fresh verified frame with its reading, outline and bar but no solution, and
  otherwise the frame on screen without a reading, or the last frame scanned
  while no frame is presented; while a solution waits to
  freeze, the shutter freezes it on its own frame, also one older than half a
  second, and saves it with the solution; right after Clear it waits until a
  frame reported after Clear was scanned, in that camera session only. A frame
  exactly half a second old is fresh, for the capture, the freeze and the help
  line, which then says nothing about a wait, and the freeze's wait ends at
  exactly three seconds. From its first frame the camera records the setting
  with the scan's settings in the diagnostics.
  `live-session.test.js` covers `refining`, `keep` (the line held as it
  stands), the counted status without automatic solving and hiding with
  nothing ever found (no loss clock, nothing written), and
  `photo-flow.test.js` the shutter drawing a live capture's stored picture on
  the panel, with that picture's label and counts, and the camera reading the
  freeze's wait from its checkbox at every call, which the diagnostics record
  with the scan's settings, each box from itself (`diagnostic-report.test.js`:
  as a boolean only).
  `app.test.js` pins the checkbox's place after automatic solving, unticked,
  and runs app.js's own code to save and restore it with its neighbours.
- `live-sampling.test.js`: what the camera samples, on the production camera,
  tracker and tracking core with a fake clock, every canvas recording its
  draws, readbacks and size assignments. Aimed at no grid on a phone's
  1440 × 1920 stream, it takes one 1600-px snapshot per detection, every
  300 ms, reads back no tracking pixels, sends nothing to the tracker, adopts
  nothing and counts only those ticks in `performance.tick`; detection gets
  the snapshot itself, and a copy only of a frame tracking verifies, whose
  copy a detection finding no grid releases at once. The scratch canvases
  are sized once while the frames keep their size (again on a new shape),
  cleared before each full-size draw, the tracking canvas asking for a
  CPU-backed context. Without an adopted frame the diagnostics get the
  video's current frame, transient. On a stalled feed a capture and the
  diagnostics keep the newest frame scanned: aimed at nothing, the frame
  detection last got for itself, also beside an older adopted frame once a
  found grid is lost; after a failed anchor or verification, with nothing
  adopted, at once or late in the back-off, the frame the worker failed on.
  An adoption and closing release it, and a detection ending after the
  camera closed never becomes it. Aimed at nothing for ten
  seconds the help line carries only the detector's guidance, with no
  grid-lost reset; a stalled feed is still reported and held, a camera with
  no frame yet reports none, a stall drops the guide's proof (with reading
  paused the outline returns only with a newly verified frame), and a
  reading out of view through a long stall is retired as a lost grid.
  `performance.overlay` counts a found grid's outline and nothing, also a
  guide without a reading, never aiming at nothing or a closed camera
  (`diagnostic-report.test.js`: its window and allowlist).
- `live-camera-recovery.test.js`: settings changes (a change of automatic
  solving or the freeze's wait leaves a pending detection alone), the
  detection deadline, Start/Stop cycles and retired completions, with a
  controlled detector, clock and canvas, and the diagnostics' picture while
  tracking is paused (the video's current frame, unverified;
  `diagnostic-retirement.test.js` checks that the report releases such a frame
  once encoded).
  `solver-handoff.test.js`: the interpreter handoff.
- `live-tracker.test.js` and `clue-recovery.test.js`: stopped workers, late
  results, failures, changed sources and manually protected cells in the
  tracking worker and targeted retries; `clue-reread.test.js`: the editor's
  per-clue re-read.
- `ocr-engine-reuse.test.js`: one OCR host across warm-up and reads, prompt
  rejection of superseded reads, the two-second replacement of a stuck call,
  disposal, the exact-image cache, cooperative cancellation, geometry-worker
  reuse and provisional readings that never start a solve.

Browser suites, in Chromium and WebKit (where each runs is in `TESTING.md`):

- `live_camera_regressions.cjs` gives a real canvas-backed MediaStream to the
  production camera with Tesseract, Pyodide and real IndexedDB: the video and
  the canvas over it sharing one box on a phone, a tablet and a desktop
  screen, with touches reaching the canvas, not the video; automatic
  solving without closing the camera, with no camera frame drawn on the canvas
  before the freeze and exactly one at it, the frozen solution (video paused
  behind the still and attached, the camera track still on, the picture
  unchanged, the chip's contrast), a live capture without automatic solving
  (the playing video, the outline and the legend counts; a fresh verified frame
  stored with its reading and shown exactly as stored), the freeze's wait for
  clearer clues, off by default (a solved reading with a retryable yellow clue
  freezes without waiting for its retries) and ticked through its checkbox
  (saved, restored after a reload, recorded in the diagnostics, and holding
  the same reading for three seconds with the wait's text), Clear without a new
  getUserMedia, an app switch while frozen
  (camera off, picture kept, Clear asking for the camera again, Save picture
  without a camera), the frozen action row on a 320-pixel screen with and
  without Start preview and a legend no larger for its counts, exact shutter
  pixels, review gating, reload and
  delete, motion and uncertain readings. It also runs
  `review_safety_regressions.cjs`, which changes and erases clues after solving
  (the frozen view keeps its frame and reading until Clear, which reads the
  change afresh) and during delayed reads and searches in both ink polarities,
  keeps the jitter and brightness controls, checks faint mixed-contrast clues
  and verifies a deletion again after reloading, with camera completion
  callbacks controlled so races reproduce. That suite in turn runs
  `structural_capture_regressions.cjs`: horizontal and vertical inequality flips
  and erasures, cage labels and walls, lighting and jitter controls, pending and
  solved (frozen until Clear) overlays, capture metadata, delayed encoding,
  conversion and database opening, reload after deletion, newer captures with
  identical timestamps, and two real tabs sharing IndexedDB and Web Locks. It
  includes 36 grey-sign cases per engine (RGB levels 150, 205 and 210, both
  orientations, flips and erasures, during reading, solving and solved display),
  and feeds the two newspaper crops in `Examples/BrowserScanner/Newspaper` as
  camera frames: a quarter- and half-pixel shift, four levels of noise, both
  together and a six percent brightness change must read as the same print,
  while an erased clue, a changed grey sign (also under shift and noise) and an
  added cage wall must read as changed.
- `live_motion_regressions.cjs` drives a real canvas stream through production
  detection, camera and session logic and Tesseract, with continual jitter and
  an animated background. It uses the 22-clue pattern from a reported screen
  failure, rendered independently (the user's photograph is not committed),
  delays real OCR to expose cancellation starvation, waits for completed rather
  than provisional readings, covers and uncovers the grid and changes one clue,
  and checks captured metadata; out-of-grid pixel witnesses in the frame the
  camera adopted (`adoptedFrame()`) prove that scene changes reached the
  verified frame, and a pending cancellable solver stub
  isolates retention from repeated-search backoff. It also measures
  static/self and translated-anchor tracking on the twelve Lexski images, which
  is tracking coverage, not detection or digit accuracy.
- `live_recovery_regressions.cjs` resamples one printed cell to simulate lost
  optical detail and restores the original raster in the next phase, through the
  production camera, detector, tracking worker and Tesseract. No OCR values,
  confidence, uncertainty, quality scores, corners or identity proofs enter the
  pipeline; reference values only score the output. A real targeted reply can be
  delayed to test a changed puzzle, and paused playback tests the freshness
  heartbeat; raw values, flags, calls and scheduling statistics are kept in
  `live-recovery.json`.
- `live_features_regressions.cjs`: the real worker, transfer and queue
  behaviour, selected-cell Tesseract calls, identical-crop skipping and
  diagnostic download privacy.
- `live_noise_regressions.cjs` runs automatic type and grid detection, the real
  tracking worker and Tesseract on a continually re-noised grey and blue
  synthetic board, then covers it and changes a digit; labels score output only,
  and no user photograph is committed. Diagnostics without imagery cannot
  establish an exact visual cause.
- `live_soak_regressions.cjs` runs twenty camera sessions per browser with
  resolution changes and delayed replies from the real tracking worker, with
  controlled video clocks and OCR, so only resource ownership is measured:
  worker counts, owned timers and source and scratch buffers must return to zero
  after each Stop. It is not a heap benchmark.
- `external_replay_regressions.cjs` replays the first three hash-selected Lexski
  test entries through automatic detection, tracking and real OCR; reference
  corners and values never reach the recognition path. Its report keeps no-read
  and quality rejections, errors, natural uncertainty and cell-level scores, and
  treats ambiguous pencil marks separately from printed givens. It records
  coverage, and it is also a gate for acquisition: the two clean pinned
  photographs (`mqec6cb3dm0d1` and `zhudyie50d0d1`, by hash and dataset
  revision) must complete an 81-cell reading in each engine within the
  25-second window, while the third, harder picture may be declined. On the
  hosted runners they read in 2.6-7.4 seconds.
- `ocr_latency_regressions.cjs` reads the two newspaper crops five times on one
  Scanner and records cold and warm read times, the time to the first
  provisional reading, worker counts and cache hits; it asserts engine reuse and
  zero unflagged discrepancies, and reports rather than enforces wall-clock
  times. `OCR_BASELINE_SITE=<other _site>` times a second build in the same
  browser session for an A/B comparison. The OCR quality suite records retries
  and keeps its accuracy and zero-unflagged-discrepancy requirements.

These fixed cases are regression controls, not a representative corpus or an
accuracy gain.

## Limits

Tracking and content checks can conservatively reject a blurred or aliased
frame, which hides overlays rather than inventing confidence. Large motion is
handled by redetection, not unbounded registration. No neural network or
solver-derived recognition is used, and the higher-detail checks are not a
speed-up. Report registration coverage, retention, time to first reading,
cancellations and false stale displays separately from static digit accuracy.
Arbitrarily tiny, blurred or occluded marks may be indistinguishable; results
stay provisional, and the user reviews recognised clues and rules.
