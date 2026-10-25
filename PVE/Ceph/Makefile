include ../../defines.mk

PERLSOURCE =   \
	KeyMigration.pm \
	Releases.pm \
	Services.pm \
	Tools.pm \

all:

.PHONY: clean
clean:
	rm -rf *~

.PHONY: install
install: $(PERLSOURCE)
	install -d $(PERLLIBDIR)/PVE/Ceph
	install -m 0644 $(PERLSOURCE) $(PERLLIBDIR)/PVE/Ceph
