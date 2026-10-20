"""Embedding match, frame aggregation and enrolment tests for `core`."""

import math
import unittest

from core import (
    Match,
    aggregate_frames,
    cosine_match,
    enrolment_consistency,
)
from core_fixtures import BASIS, embedding_at


class MatchTests(unittest.TestCase):
    def setUp(self):
        self.probe = BASIS[0]
        self.gallery = {
            "subject-a": [embedding_at(math.acos(0.55), axis=1)],
            "subject-b": [embedding_at(math.acos(0.52), axis=2)],
        }

    def test_cosine_match_refuses_inside_the_margin(self):
        # 0.55 and 0.52 are both over threshold; the 0.03 gap is under the 0.06
        # margin, so this is an ambiguous face and there is no winner to pick.
        self.assertIsNone(cosine_match(self.probe, self.gallery))

    def test_cosine_match_accepts_a_clear_winner(self):
        self.gallery["subject-b"] = [embedding_at(math.acos(0.20), axis=2)]
        match = cosine_match(self.probe, self.gallery)
        self.assertIsNotNone(match)
        self.assertEqual(match.subject, "subject-a")
        self.assertAlmostEqual(match.score, 0.55, places=6)
        self.assertAlmostEqual(match.runner_up, 0.20, places=6)

    def test_cosine_match_refuses_below_threshold(self):
        gallery = {"subject-a": [embedding_at(math.acos(0.30), axis=1)]}
        self.assertIsNone(cosine_match(self.probe, gallery))

    def test_an_unknown_face_matches_nobody_rather_than_the_nearest_neighbour(self):
        self.assertIsNone(cosine_match(BASIS[7], self.gallery))


class FrameAggregationTests(unittest.TestCase):
    @staticmethod
    def votes(agreeing: int, total: int = 25) -> list[Match | None]:
        matched = [Match("subject-a", 0.61, 0.20) for _ in range(agreeing)]
        return matched + [None] * (total - agreeing)

    def test_eleven_of_twenty_five_is_refused(self):
        self.assertIsNone(aggregate_frames(self.votes(11)))

    def test_twelve_of_twenty_five_is_accepted(self):
        result = aggregate_frames(self.votes(12))
        self.assertIsNotNone(result)
        self.assertEqual(result.subject, "subject-a")
        self.assertEqual(result.agreeing, 12)
        self.assertEqual(result.usable, 25)

    def test_no_agreeing_frames_at_all_is_refused(self):
        self.assertIsNone(aggregate_frames([None] * 25))

    def test_one_of_two_is_enough_for_quick(self):
        result = aggregate_frames([Match("subject-a", 0.61, 0.20), None], min_agreeing=1)
        self.assertEqual(result.subject, "subject-a")

    def test_two_frames_naming_two_people_is_refused(self):
        votes = [Match("subject-a", 0.61, 0.20), Match("subject-b", 0.60, 0.20)]
        self.assertIsNone(aggregate_frames(votes, min_agreeing=1))


class EnrolmentTests(unittest.TestCase):
    def test_an_off_centroid_member_is_rejected_and_named(self):
        embeddings = [embedding_at(angle) for angle in (0.0, 0.05, 0.08)]
        embeddings.append(embedding_at(1.4, axis=3))
        report = enrolment_consistency(embeddings)
        self.assertFalse(report.ok)
        self.assertEqual(report.index, 3)
        self.assertEqual(report.reason, "inconsistent")
        self.assertGreater(report.centroid_distance, 0.30)

    def test_a_tight_set_is_accepted(self):
        embeddings = [embedding_at(angle) for angle in (0.0, 0.05, 0.08, 0.11, 0.06)]
        report = enrolment_consistency(embeddings)
        self.assertTrue(report.ok, report)
        self.assertIsNone(report.index)

    def test_a_clip_that_matches_another_subject_is_rejected_and_named(self):
        others = {"subject-b": [embedding_at(0.02)]}
        report = enrolment_consistency([embedding_at(0.0), embedding_at(0.04)], others=others)
        self.assertFalse(report.ok)
        self.assertEqual(report.index, 0)
        self.assertEqual(report.reason, "conflicts_with_subject")
        self.assertEqual(report.nearest_other_subject, "subject-b")


if __name__ == "__main__":
    unittest.main()
