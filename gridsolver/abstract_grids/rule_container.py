from typing import Set

from gridsolver.rules.rules import Rule, Guarantee


class RuleContainer:
    def __init__(self):
        self.rules: Set[Rule] = set()
        self._rules_ia: Set[Rule] = set()
        self.guarantees: Set[Guarantee] = set()
        self._guarantees_ia: Set[Guarantee] = set()

    def __eq__(self, other: 'RuleContainer') -> bool:
        if not isinstance(other, type(self)):
            return False
        return self.rules == other.rules and self._rules_ia == other._rules_ia and \
               self.guarantees == other.guarantees and self._guarantees_ia == other._guarantees_ia

    def __ne__(self, other: 'RuleContainer') -> bool:
        return not self == other
