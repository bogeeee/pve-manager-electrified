include ../../../../defines.mk

# for node independent, cluster-wide applicable, API endpoints
# ensure we do not conflict with files shipped by pve-cluster!!
PERLSOURCE= 	\
	Dir.pm  \
	PCI.pm	\
	USB.pm

all:

.PHONY: clean
clean:
	rm -rf *~

.PHONY: install
install: ${PERLSOURCE}
	install -d ${PERLLIBDIR}/PVE/API2/Cluster/Mapping
	install -m 0644 ${PERLSOURCE} ${PERLLIBDIR}/PVE/API2/Cluster/Mapping
