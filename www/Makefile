include ../defines.mk
# Note: images+css are done twice (with classic build and also blindy copied - we just leave it for compatibility for now)
SUBDIRS = images css manager6 mobile

all:

.PHONY: install
install:
	set -e && for i in ${SUBDIRS}; do ${MAKE} -C $$i $@; done
	install -d ${WWWBASEDIR}
	rsync -a . ${WWWBASEDIR} --exclude Makefile --exclude manager6 --exclude mobile --exclude touch --exclude node_modules --exclude .npmignore

.PHONY: check
check:
	$(MAKE) -C manager6 $@

.PHONY: clean
clean:
	set -e && for i in $(SUBDIRS); do $(MAKE) -C $$i $@; done
