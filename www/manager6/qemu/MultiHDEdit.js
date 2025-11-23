Ext.define('PVE.qemu.MultiHDPanel', {
    extend: 'PVE.panel.MultiDiskPanel',
    alias: 'widget.pveMultiHDPanel',

    onlineHelp: 'qm_hard_disk',

    importDisk: true,

    controller: {
        xclass: 'Ext.app.ViewController',

        // maxCount is the sum of all controller ids - 1 (ide2 is fixed in the wizard)
        maxCount:
            Object.values(PVE.Utils.diskControllerMaxIDs).reduce(
                (previous, current) => previous + current,
                0,
            ) - 1,

        getNextFreeDisk: function (vmconfig) {
            let clist = PVE.Utils.sortByPreviousUsage(vmconfig);
            return PVE.Utils.nextFreeDisk(clist, vmconfig);
        },

        addPanel: function (itemId, vmconfig, nextFreeDisk, importDisk) {
            let me = this;
            return me.getView().add({
                vmconfig,
                border: false,
                showAdvanced: Ext.state.Manager.getProvider().get('proxmox-advanced-cb'),
                xtype: 'pveQemuHDInputPanel',
                bind: {
                    nodename: '{nodename}',
                },
                padding: '0 0 0 5',
                itemId,
                isCreate: true,
                insideWizard: true,
                importDisk,
            });
        },

        getBaseVMConfig: function () {
            let me = this;
            let vm = me.getViewModel();

            let res = {
                ide2: 'media=cdrom',
                scsihw: vm.get('current.scsihw'),
                ostype: vm.get('current.ostype'),
            };

            if (vm.get('current.ide0') === 'some') {
                res.ide0 = 'media=cdrom';
            }

            return res;
        },

        diskSorter: {
            sorterFn: function (rec1, rec2) {
                let [, name1, id1] = PVE.Utils.bus_match.exec(rec1.data.name);
                let [, name2, id2] = PVE.Utils.bus_match.exec(rec2.data.name);

                if (name1 === name2) {
                    return parseInt(id1, 10) - parseInt(id2, 10);
                }

                return name1 < name2 ? -1 : 1;
            },
        },

        deleteDisabled: () => false,
    },
});
