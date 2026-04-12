from gridsolver.grid_classes.futoshiki import Futoshiki

n = 5
g = Futoshiki(n)
g.ext_ineqs([((1, 0), (1, 1)), ((2, 3), (3, 3)), ((4, 4), (3, 4)), ((3, 4), (3, 3)), ((2, 2), (3, 2)),
             ((4, 3), (4, 4))])

g[0, 0] = 1
g[0, 1] = 2
g[0, 2] = 3
g[0, 3] = 4
#
g[1, 0] = 3
g[4, 0] = 4
