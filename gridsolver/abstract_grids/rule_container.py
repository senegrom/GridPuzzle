from typing import Set

from gridsolver.rules.rules import Rule, Guarantee


class RuleContainer:
    def __init__(self):
        self.rules: Set[Rule] = set()
        self.rules_ia: Set[Rule] = set()
        self.guarantees: Set[Guarantee] = set()
        self.guarantees_ia: Set[Guarantee] = set()

    def __eq__(self, other: 'RuleContainer') -> bool:
        if not isinstance(other, type(self)):
            return False
        return self.rules == other.rules and self.rules_ia == other.rules_ia and \
               self.guarantees == other.guarantees and self.guarantees_ia == other.guarantees_ia

    def __ne__(self, other: 'RuleContainer') -> bool:
        return not self == other
