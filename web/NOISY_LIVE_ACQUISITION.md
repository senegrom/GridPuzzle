# Noise units and live acquisition diagnostics

The interior comparison stretches contrast against its original anchor, and
sensor grain is stretched with it: a fixed four-level floor in stretched units
turned ordinary paper grain into changed-content evidence and could block
acquisition before OCR started. Scaling that floor by the stretch (#73) also
raised it for every faint clean print, so an 8 becoming a 3 went unnoticed up
to print contrast 80 and a 3 becoming an 8 up to 130. The floor is now
measured: 1.5 times the frame-to-frame noise of the two regions compared (their
median absolute difference at the chosen registration, as a standard
deviation), in the region's own units and never below four levels. A clean
print keeps the four-level floor; a grainy one gets a floor that grows with its
grain. The unstretched structural strips use the same rule, so grain there is
no longer a changed label, sign or wall. On synthetic 40-pixel cells, grain of
±4 to ±10 levels produces no false changes (#73: 7-17% at ±8 and ±10), a whole
9x9 board with ±8 grain at 30 pixels per cell stays unchanged (#73: 81% of
pairs changed), and averaged over the review's noisy sweep the 8/3 stroke is
caught more often than under #73. Heavy grain can still hide a faint stroke;
detection falls as grain rises. High-contrast guards keep their bounds. A
registered rectangle alone still never proves identity, and no solver result
supplies missing clue pixels.

The tracking worker returns bounded rejection reasons (cell, structural region,
geometry or missing anchor), with numeric region indices only, never image bytes.
Repeated rejected candidates surface an explicit alignment message and Restart;
Save picture retains the independent single-photo crop/read route. These reasons
help distinguish pre-OCR acquisition failure from OCR, rendering or worker delay.

`live_noise_regressions.cjs` runs automatic type/grid detection, the real tracking
worker and Tesseract on a continually re-noised grey/blue synthetic board, then
covers it and changes a digit. Labels score output only. No user photograph is
committed. This is a bounded failure regression, not proof that every noisy or
blurred phone capture will match; diagnostics without imagery cannot establish
an exact visual cause.
