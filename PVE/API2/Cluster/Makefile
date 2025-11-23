include ../../../defines.mk

SUBDIRS=Mapping		\
	BulkAction

# for node independent, cluster-wide applicable, API endpoints
# ensure we do not conflict with files shipped by pve-cluster!!
PERLSOURCE= 			\
	BackupInfo.pm		\
	BulkAction.pm		\
	MetricServer.pm		\
	Mapping.pm		\
	Notifications.pm		\
	Jobs.pm			\
	Ceph.pm

all:

.PHONY: clean
clean:
	rm -rf *~
	set -e && for i in ${SUBDIRS}; do ${MAKE} -C $$i $@; done

.PHONY: install
install: $(PERLSOURCE)
	install -d $(PERLLIBDIR)/PVE/API2/Cluster
	install -m 0644 $(PERLSOURCE) $(PERLLIBDIR)/PVE/API2/Cluster
	set -e && for i in $(SUBDIRS); do $(MAKE) -C $$i $@; done
