from gridsolver.rules.rules import Guarantee, Rule


class RuleContainer:
    def __init__(self) -> None:
        self.rules: set[Rule] = set()
        self.rules_ia: set[Rule] = set()
        self.guarantees: set[Guarantee] = set()
        self.guarantees_ia: set[Guarantee] = set()

    def __eq__(self, other: object) -> bool:
        if type(other) is not type(self):
            return False
        return (
            self.rules == other.rules
            and self.rules_ia == other.rules_ia
            and self.guarantees == other.guarantees
            and self.guarantees_ia == other.guarantees_ia
        )
