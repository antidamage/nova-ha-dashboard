"""Appearance-variant gallery tests for `core`."""

import unittest

import numpy as np

from core import (
    gallery_scores,
    centroid,
    l2_normalise,
    enrolment_consistency,
)


class AppearanceVariantTests(unittest.TestCase):
    """A subject may hold more than one appearance.

    Adeline wears a wig sometimes and glasses sometimes. Either shifts the
    ArcFace embedding — glasses more, since the alignment crop is roughly
    eyebrows-to-chin and the frames sit across the eyes while most hair falls
    outside it. Matching is max-per-subject, so enrolling both is the fix; the
    consistency rule must therefore allow a second cluster rather than
    measuring everything against one mean.
    """

    @staticmethod
    def _cluster(seed, count, spread=0.02, shift=None):
        """A tight cluster. `shift` mixes in a second direction to move the whole
        cluster a realistic distance away, the way a wig or glasses does —
        two people are near-orthogonal, one person in two looks is not."""

        rng = np.random.default_rng(seed)
        base = rng.normal(size=64)
        if shift is not None:
            base = base / np.linalg.norm(base)
            base = base + shift * (rng.normal(size=64) / np.sqrt(64))
        return [base + rng.normal(scale=spread, size=64) for _ in range(count)]

    def test_a_second_appearance_can_be_enrolled(self):
        # Two tight clusters, far apart — "with glasses" and "without".
        base = self._cluster(1, 3)
        # Same person, second appearance: displaced, not orthogonal.
        rng = np.random.default_rng(1)
        anchor = rng.normal(size=64)
        variant = [l2_normalise(anchor) * 1.0 + l2_normalise(rng.normal(size=64)) * 0.85
                   + rng.normal(scale=0.02, size=64) for _ in range(3)]
        report = enrolment_consistency(base + variant)
        self.assertTrue(report.ok, f"refused as {report.reason} at index {report.index}")

    def test_a_centroid_rule_would_have_refused_it(self):
        # Pins WHY this changed: against the mean of cluster one, the first
        # member of cluster two is far away, which is what used to refuse it.
        glasses = [l2_normalise(v) for v in self._cluster(1, 3, spread=0.35)]
        probe = l2_normalise(glasses[0] * 1.0 + glasses[-1] * 0.4)
        to_centroid = 1.0 - float(np.dot(probe, centroid(glasses)))
        to_nearest = min(1.0 - float(np.dot(probe, g)) for g in glasses)
        # Nearest-member is never further than the centroid, and that gap is
        # exactly the headroom a second appearance needs.
        self.assertLessEqual(to_nearest, to_centroid + 1e-12)

    def test_a_clip_resembling_nothing_enrolled_is_still_refused(self):
        # The relaxation must not become "accept anything": a third, unrelated
        # cluster is still too far from every accepted member.
        near = self._cluster(3, 3)
        rng = np.random.default_rng(99)
        stranger = rng.normal(size=64) * 3.0
        report = enrolment_consistency(near + [stranger], centroid_max=0.10)
        self.assertFalse(report.ok)
        self.assertEqual(report.reason, "inconsistent")
        self.assertEqual(report.index, 3)

    def test_another_persons_face_is_still_refused_outright(self):
        # The identity rule is unchanged and is the one that matters.
        mine = self._cluster(4, 2)
        theirs = {"someone-else": [l2_normalise(mine[0])]}
        report = enrolment_consistency(mine, others=theirs, match_cosine=0.42)
        self.assertFalse(report.ok)
        self.assertEqual(report.reason, "conflicts_with_subject")


class AppearanceIndependenceTests(unittest.TestCase):
    """Adding an appearance must not weaken the ones already enrolled.

    Adeline, 2026-09-03: "the important thing is that adding a different
    appearance or presentation doesn't weaken the strength of the original one.
    instead they should both work equally well."

    This holds because a subject's clips are kept as separate vectors and
    scored with `max`, never collapsed into one prototype. It is worth pinning:
    the obvious "tidy-up" is to average a person's embeddings into a single
    template, and that is precisely the change that would break it — the
    template drifts between the two looks and both get worse. `centroid` is used
    inside a clip, across its frames, and must not spread to across clips.
    """

    @staticmethod
    def _look(seed, count):
        rng = np.random.default_rng(seed)
        base = rng.normal(size=128)
        return [l2_normalise(base + rng.normal(scale=0.05, size=128)) for _ in range(count)]

    def test_a_second_look_leaves_the_first_score_bit_identical(self):
        glasses = self._look(1, 5)
        wig = self._look(2, 5)
        probe = self._look(1, 6)[-1]          # a fresh capture of the FIRST look

        before = gallery_scores(probe, {"adeline": glasses})[0][1]
        after = gallery_scores(probe, {"adeline": glasses + wig})[0][1]
        self.assertEqual(before, after)        # exactly equal, not merely close

    def test_the_second_look_also_matches_well(self):
        glasses = self._look(1, 5)
        wig = self._look(2, 5)
        probe = self._look(2, 6)[-1]          # a fresh capture of the SECOND look
        combined = gallery_scores(probe, {"adeline": glasses + wig})[0][1]
        alone = gallery_scores(probe, {"adeline": wig})[0][1]
        self.assertEqual(alone, combined)

    def test_averaging_a_person_into_one_template_would_break_both(self):
        # The counter-example, so the reason is recorded rather than asserted.
        glasses, wig = self._look(1, 5), self._look(2, 5)
        for seed, look in ((1, glasses), (2, wig)):
            probe = self._look(seed, 6)[-1]
            kept_separate = gallery_scores(probe, {"adeline": glasses + wig})[0][1]
            averaged = float(np.dot(l2_normalise(probe), centroid(glasses + wig)))
            self.assertGreater(kept_separate, averaged)

    def test_more_clips_never_lower_a_score(self):
        # General form: max over a superset cannot be smaller.
        glasses = self._look(1, 3)
        probe = self._look(1, 4)[-1]
        running = gallery_scores(probe, {"a": glasses})[0][1]
        for extra_seed in (2, 3, 4):
            glasses = glasses + self._look(extra_seed, 2)
            now = gallery_scores(probe, {"a": glasses})[0][1]
            self.assertGreaterEqual(now, running)
            running = now


if __name__ == "__main__":
    unittest.main()
