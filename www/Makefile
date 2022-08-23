include ../defines.mk
SUBDIRS = images css manager6 mobile

all:

.PHONY: install
install:
	set -e && for i in ${SUBDIRS}; do ${MAKE} -C $$i $@; done
	install -m 0644 index.html.tpl ${WWWBASEDIR}
	install -d ${WWWBASEDIR}
	install -m 0644 u2f-api.js ${WWWBASEDIR}

.PHONY: check
check:
	$(MAKE) -C manager6 $@

.PHONY: clean
clean:
	set -e && for i in $(SUBDIRS); do $(MAKE) -C $$i $@; done
