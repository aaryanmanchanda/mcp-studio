import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "gen" / "python"))

from nodes.quiz import format_quiz  # noqa: E402

MC = [{"question": "Q one?", "options": ["red", "green", "blue", "pink"], "answer": "blue", "why": "because"}]
SA = [{"question": "Explain X.", "options": [], "answer": "X is Y.", "why": ""}]


class FormatQuiz(unittest.TestCase):
    def test_lettered_options_and_answer_key_with_letter(self):
        out = format_quiz("T", MC)
        self.assertIn("1. Q one?", out)
        self.assertIn("   C) blue", out)
        self.assertIn("ANSWER KEY", out)
        self.assertIn("1. C) blue", out)
        self.assertIn("because", out)

    def test_answer_key_can_be_left_out(self):
        out = format_quiz("T", MC, include_answers=False)
        self.assertNotIn("ANSWER KEY", out)
        self.assertNotIn("because", out)

    def test_short_answer_has_no_options_and_plain_answer(self):
        out = format_quiz("T", SA)
        self.assertNotIn("A)", out)
        self.assertIn("1. X is Y.", out)


if __name__ == "__main__":
    unittest.main()
