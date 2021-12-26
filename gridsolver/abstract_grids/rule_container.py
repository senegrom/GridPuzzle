from typing import Tuple

from sortedcontainers import SortedSet

from gridsolver.rules.rules import Rule, Guarantee


class RuleContainer:
    def __init__(self):
        self.rules: SortedSet[Rule] = SortedSet(key=RuleContainer._rule_key)
        self._rules_ia: SortedSet[Rule] = SortedSet(key=RuleContainer._rule_key)
        self.guarantees: SortedSet[Guarantee] = SortedSet(key=RuleContainer._grt_kee)
        self._guarantees_ia: SortedSet[Guarantee] = SortedSet(key=RuleContainer._grt_kee)

    def __eq__(self, other: 'RuleContainer') -> bool:
        if not isinstance(other, type(self)):
            return False
        return self.rules == other.rules and self._rules_ia == other._rules_ia and \
               self.guarantees == other.guarantees and self._guarantees_ia == other._guarantees_ia

    def __ne__(self, other: 'RuleContainer') -> bool:
        return not self == other

    @staticmethod
    def _rule_key(rule: Rule) -> Tuple:
        return rule.cells, type(rule).__name__

    @staticmethod
    def _grt_kee(gt: Guarantee) -> Tuple:
        return gt.val, gt.cells
