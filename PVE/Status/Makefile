include ../../defines.mk

PERLSOURCE = 			\
	Graphite.pm		\
	InfluxDB.pm		\
	OpenTelemetry.pm	\
	Plugin.pm

all:

.PHONY: clean
clean:
	rm -rf *~

.PHONY: install 
install: $(PERLSOURCE)
	install -d $(PERLLIBDIR)/PVE/Status
	install -m 0644 $(PERLSOURCE) $(PERLLIBDIR)/PVE/Status
