/* 'change' property is assigned a string and then a function */
Ext.define('PVE.qemu.HDInputPanel', {
    extend: 'Proxmox.panel.InputPanel',
    alias: 'widget.pveQemuHDInputPanel',
    onlineHelp: 'qm_hard_disk',

    insideWizard: false,

    unused: false, // ADD usused disk imaged

    importDisk: false, // use import options
    importSelection: undefined, // preselect a disk to import

    vmconfig: {}, // used to select usused disks

    viewModel: {
        data: {
            isSCSI: false,
            isVirtIO: false,
            isSCSISingle: false,
        },
    },

    controller: {
        xclass: 'Ext.app.ViewController',

        onControllerChange: function (field) {
            let me = this;
            let vm = this.getViewModel();

            let value = field.getValue();
            vm.set('isSCSI', value.match(/^scsi/));
            vm.set('isVirtIO', value.match(/^virtio/));

            me.fireIdChange();
        },

        fireIdChange: function () {
            let view = this.getView();
            view.fireEvent('diskidchange', view, view.bussel.getConfId());
        },

        control: {
            'field[name=controller]': {
                change: 'onControllerChange',
                afterrender: 'onControllerChange',
            },
            'field[name=deviceid]': {
                change: 'fireIdChange',
            },
            'field[name=scsiController]': {
                change: function (f, value) {
                    let vm = this.getViewModel();
                    vm.set('isSCSISingle', value === 'virtio-scsi-single');
                },
            },
        },

        init: function (view) {
            var vm = this.getViewModel();
            if (view.isCreate) {
                vm.set('isIncludedInBackup', true);
            }
            if (view.confid) {
                vm.set('isSCSI', view.confid.match(/^scsi/));
                vm.set('isVirtIO', view.confid.match(/^virtio/));
            }
        },
    },

    onGetValues: function (values) {
        var me = this;

        var params = {};
        var confid = me.confid || values.controller + values.deviceid;

        if (me.unused) {
            me.drive.file = me.vmconfig[values.unusedId];
            confid = values.controller + values.deviceid;
        } else if (me.isCreate) {
            if (values.hdimage) {
                me.drive.file = values.hdimage;
            } else {
                let disksize = values['import-from'] ? 0 : values.disksize;
                me.drive.file = `${values.hdstorage}:${disksize}`;
                PVE.Utils.propertyStringSet(me.drive, values['import-from'], 'import-from');
            }
            me.drive.format = values.diskformat;
        }

        PVE.Utils.propertyStringSet(me.drive, !values.backup, 'backup', '0');
        PVE.Utils.propertyStringSet(me.drive, values.noreplicate, 'replicate', 'no');
        PVE.Utils.propertyStringSet(me.drive, values.discard, 'discard', 'on');
        PVE.Utils.propertyStringSet(me.drive, values.ssd, 'ssd', 'on');
        PVE.Utils.propertyStringSet(me.drive, values.iothread, 'iothread', 'on');
        PVE.Utils.propertyStringSet(me.drive, values.readOnly, 'ro', 'on');
        PVE.Utils.propertyStringSet(me.drive, values.cache, 'cache');
        PVE.Utils.propertyStringSet(me.drive, values.aio, 'aio');

        ['mbps_rd', 'mbps_wr', 'iops_rd', 'iops_wr'].forEach((name) => {
            let burst_name = `${name}_max`;
            PVE.Utils.propertyStringSet(me.drive, values[name], name);
            PVE.Utils.propertyStringSet(me.drive, values[burst_name], burst_name);
        });

        params[confid] = PVE.Parser.printQemuDrive(me.drive);

        return params;
    },

    updateVMConfig: function (vmconfig) {
        var me = this;
        me.vmconfig = vmconfig;
        me.bussel?.updateVMConfig(vmconfig);
    },

    setVMConfig: function (vmconfig) {
        var me = this;

        me.vmconfig = vmconfig;

        if (me.bussel) {
            me.bussel.setVMConfig(vmconfig);
            me.scsiController.setValue(vmconfig.scsihw);
        }
        if (me.unusedDisks) {
            let disklist = [];
            Ext.Object.each(vmconfig, function (key, value) {
                if (key.match(/^unused\d+$/)) {
                    disklist.push([key, value]);
                }
            });
            me.unusedDisks.store.loadData(disklist);
            me.unusedDisks.setValue(me.confid);
        }
    },

    setDrive: function (drive) {
        var me = this;

        me.drive = drive;

        var values = {};
        var match = drive.file.match(/^([^:]+):/);
        if (match) {
            values.hdstorage = match[1];
        }

        values.hdimage = drive.file;
        values.backup = PVE.Parser.parseBoolean(drive.backup, 1);
        values.noreplicate = !PVE.Parser.parseBoolean(drive.replicate, 1);
        values.diskformat = drive.format || 'raw';
        values.cache = drive.cache || '__default__';
        values.discard = drive.discard === 'on';
        values.ssd = PVE.Parser.parseBoolean(drive.ssd);
        values.iothread = PVE.Parser.parseBoolean(drive.iothread);
        values.readOnly = PVE.Parser.parseBoolean(drive.ro);
        values.aio = drive.aio || '__default__';

        values.mbps_rd = drive.mbps_rd;
        values.mbps_wr = drive.mbps_wr;
        values.iops_rd = drive.iops_rd;
        values.iops_wr = drive.iops_wr;
        values.mbps_rd_max = drive.mbps_rd_max;
        values.mbps_wr_max = drive.mbps_wr_max;
        values.iops_rd_max = drive.iops_rd_max;
        values.iops_wr_max = drive.iops_wr_max;

        me.setValues(values);
    },

    setNodename: function (nodename) {
        var me = this;
        me.down('#hdstorage').setNodename(nodename);
        me.down('#hdimage').setStorage(undefined, nodename);

        me.lookup('new-disk')?.setNodename(nodename);
        me.lookup('import-source')?.setNodename(nodename);
        me.lookup('import-source-file')?.setNodename(nodename);
        me.lookup('import-target')?.setNodename(nodename);
    },

    hasAdvanced: true,

    initComponent: function () {
        var me = this;

        me.drive = {};

        let column1 = [];
        let column2 = [];

        let advancedColumn1 = [];
        let advancedColumn2 = [];

        if (!me.confid || me.unused) {
            me.bussel = Ext.create('PVE.form.ControllerSelector', {
                vmconfig: me.vmconfig,
                selectFree: true,
            });
            column1.push(me.bussel);

            me.scsiController = Ext.create('Ext.form.field.Display', {
                fieldLabel: gettext('SCSI Controller'),
                reference: 'scsiController',
                name: 'scsiController',
                bind: me.insideWizard
                    ? {
                          value: '{current.scsihw}',
                          visible: '{isSCSI}',
                      }
                    : {
                          visible: '{isSCSI}',
                      },
                renderer: PVE.Utils.render_scsihw,
                submitValue: false,
                hidden: true,
            });
            column1.push(me.scsiController);
        }

        if (me.unused) {
            me.unusedDisks = Ext.create('Proxmox.form.KVComboBox', {
                name: 'unusedId',
                fieldLabel: gettext('Disk image'),
                matchFieldWidth: false,
                listConfig: {
                    width: 350,
                },
                data: [],
                allowBlank: false,
            });
            column1.push(me.unusedDisks);
        } else if (me.isCreate) {
            if (!me.importDisk) {
                column1.push({
                    reference: 'new-disk',
                    xtype: 'pveDiskStorageSelector',
                    storageContent: 'images',
                    name: 'disk',
                    nodename: me.nodename,
                    autoSelect: me.insideWizard,
                });
            } else {
                if (me.importSelection) {
                    column1.push({
                        xtype: 'displayfield',
                        fieldLabel: gettext('Selected Image'),
                        value: me.importSelection,
                    });
                    column1.push({
                        xtype: 'hiddenfield',
                        name: 'import-from',
                        value: me.importSelection,
                    });
                } else {
                    column1.push({
                        xtype: 'pveStorageSelector',
                        reference: 'import-source',
                        fieldLabel: gettext('Import Storage'),
                        name: 'import-source-storage',
                        storageContent: 'import',
                        nodename: me.nodename,
                        autoSelect: me.insideWizard,
                        disabled: false,
                        listeners: {
                            change: function (_selector, storage) {
                                me.lookup('import-source-file').setStorage(storage);
                                me.lookup('import-source-file').setDisabled(!storage);
                            },
                        },
                    });
                    column1.push({
                        xtype: 'pveFileSelector',
                        reference: 'import-source-file',
                        fieldLabel: gettext('Select Image'),
                        storageContent: 'import',
                        name: 'import-from',
                        filter: (rec) => ['qcow2', 'vmdk', 'raw'].indexOf(rec?.data?.format) !== -1,
                        nodename: me.nodename,
                    });
                }
                column1.push({
                    xtype: 'pveDiskStorageSelector',
                    reference: 'import-target',
                    storageLabel: gettext('Target Storage'),
                    hideSize: true,
                    storageContent: 'images',
                    name: 'disk',
                    nodename: me.nodename,
                    autoSelect: me.insideWizard,
                });
            }
        } else {
            column1.push({
                xtype: 'textfield',
                disabled: true,
                submitValue: false,
                fieldLabel: gettext('Disk image'),
                name: 'hdimage',
            });
        }

        column2.push(
            {
                xtype: 'CacheTypeSelector',
                name: 'cache',
                value: '__default__',
                fieldLabel: gettext('Cache'),
            },
            {
                xtype: 'proxmoxcheckbox',
                fieldLabel: gettext('Discard'),
                reference: 'discard',
                name: 'discard',
            },
            {
                xtype: 'proxmoxcheckbox',
                name: 'iothread',
                fieldLabel: 'IO thread',
                clearOnDisable: true,
                bind:
                    me.insideWizard || me.isCreate
                        ? {
                              disabled: '{!isVirtIO && !isSCSI}',
                              // Checkbox.setValue handles Arrays in a different way, therefore cast to bool
                              value: '{!!isVirtIO || (isSCSI && isSCSISingle)}',
                          }
                        : {
                              disabled: '{!isVirtIO && !isSCSI}',
                          },
            },
        );

        advancedColumn1.push(
            {
                xtype: 'proxmoxcheckbox',
                fieldLabel: gettext('SSD emulation'),
                name: 'ssd',
                clearOnDisable: true,
                bind: {
                    disabled: '{isVirtIO}',
                },
            },
            {
                xtype: 'proxmoxcheckbox',
                name: 'readOnly', // `ro` in the config, we map in get/set values
                defaultValue: 0,
                fieldLabel: gettext('Read-only'),
                clearOnDisable: true,
                bind: {
                    disabled: '{!isVirtIO && !isSCSI}',
                },
            },
        );

        advancedColumn2.push(
            {
                xtype: 'proxmoxcheckbox',
                fieldLabel: gettext('Backup'),
                autoEl: {
                    tag: 'div',
                    'data-qtip': gettext('Include volume in backup job'),
                },
                name: 'backup',
                bind: {
                    value: '{isIncludedInBackup}',
                },
            },
            {
                xtype: 'proxmoxcheckbox',
                fieldLabel: gettext('Skip replication'),
                name: 'noreplicate',
            },
            {
                xtype: 'proxmoxKVComboBox',
                name: 'aio',
                fieldLabel: gettext('Async IO'),
                allowBlank: false,
                value: '__default__',
                comboItems: [
                    ['__default__', Proxmox.Utils.defaultText + ' (io_uring)'],
                    ['io_uring', 'io_uring'],
                    ['native', 'native'],
                    ['threads', 'threads'],
                ],
            },
        );

        let labelWidth = 140;

        let bwColumn1 = [
            {
                xtype: 'numberfield',
                name: 'mbps_rd',
                minValue: 1,
                step: 1,
                fieldLabel: gettext('Read limit') + ' (MB/s)',
                labelWidth: labelWidth,
                emptyText: gettext('unlimited'),
            },
            {
                xtype: 'numberfield',
                name: 'mbps_wr',
                minValue: 1,
                step: 1,
                fieldLabel: gettext('Write limit') + ' (MB/s)',
                labelWidth: labelWidth,
                emptyText: gettext('unlimited'),
            },
            {
                xtype: 'proxmoxintegerfield',
                name: 'iops_rd',
                minValue: 10,
                step: 10,
                fieldLabel: gettext('Read limit') + ' (ops/s)',
                labelWidth: labelWidth,
                emptyText: gettext('unlimited'),
            },
            {
                xtype: 'proxmoxintegerfield',
                name: 'iops_wr',
                minValue: 10,
                step: 10,
                fieldLabel: gettext('Write limit') + ' (ops/s)',
                labelWidth: labelWidth,
                emptyText: gettext('unlimited'),
            },
        ];

        let bwColumn2 = [
            {
                xtype: 'numberfield',
                name: 'mbps_rd_max',
                minValue: 1,
                step: 1,
                fieldLabel: gettext('Read max burst') + ' (MB)',
                labelWidth: labelWidth,
                emptyText: gettext('default'),
            },
            {
                xtype: 'numberfield',
                name: 'mbps_wr_max',
                minValue: 1,
                step: 1,
                fieldLabel: gettext('Write max burst') + ' (MB)',
                labelWidth: labelWidth,
                emptyText: gettext('default'),
            },
            {
                xtype: 'proxmoxintegerfield',
                name: 'iops_rd_max',
                minValue: 10,
                step: 10,
                fieldLabel: gettext('Read max burst') + ' (ops)',
                labelWidth: labelWidth,
                emptyText: gettext('default'),
            },
            {
                xtype: 'proxmoxintegerfield',
                name: 'iops_wr_max',
                minValue: 10,
                step: 10,
                fieldLabel: gettext('Write max burst') + ' (ops)',
                labelWidth: labelWidth,
                emptyText: gettext('default'),
            },
        ];

        me.items = [
            {
                xtype: 'tabpanel',
                plain: true,
                bodyPadding: 10,
                border: 0,
                items: [
                    {
                        title: gettext('Disk'),
                        xtype: 'inputpanel',
                        reference: 'diskpanel',
                        column1,
                        column2,
                        advancedColumn1,
                        advancedColumn2,
                        showAdvanced: me.showAdvanced,
                        getValues: () => ({}),
                    },
                    {
                        title: gettext('Bandwidth'),
                        xtype: 'inputpanel',
                        reference: 'bwpanel',
                        column1: bwColumn1,
                        column2: bwColumn2,
                        showAdvanced: me.showAdvanced,
                        getValues: () => ({}),
                    },
                ],
            },
        ];

        me.callParent();
    },

    setAdvancedVisible: function (visible) {
        this.lookup('diskpanel').setAdvancedVisible(visible);
        this.lookup('bwpanel').setAdvancedVisible(visible);
    },
});

Ext.define('PVE.qemu.HDEdit', {
    extend: 'Proxmox.window.Edit',

    isAdd: true,

    backgroundDelay: 5,

    width: 600,
    bodyPadding: 0,

    importDisk: false,

    initComponent: function () {
        var me = this;

        var nodename = me.pveSelNode.data.node;
        if (!nodename) {
            throw 'no node name specified';
        }

        var unused = me.confid && me.confid.match(/^unused\d+$/);

        me.isCreate = me.confid ? unused : true;

        var ipanel = Ext.create('PVE.qemu.HDInputPanel', {
            confid: me.confid,
            nodename: nodename,
            unused: unused,
            isCreate: me.isCreate,
            importDisk: me.importDisk,
        });

        if (unused) {
            me.subject = gettext('Unused Disk');
        } else if (me.isCreate) {
            me.subject = gettext('Hard Disk');
        } else {
            me.subject = gettext('Hard Disk') + ' (' + me.confid + ')';
        }

        me.items = [ipanel];

        me.callParent();
        /* 'data' is assigned an empty array in same file, and here we
         * use it like an object
         */
        me.load({
            success: function (response, options) {
                ipanel.setVMConfig(response.result.data);
                if (me.confid) {
                    let value = response.result.data[me.confid];
                    let drive = PVE.Parser.parseQemuDrive(me.confid, value);
                    if (!drive) {
                        Ext.Msg.alert(gettext('Error'), 'Unable to parse drive options');
                        me.close();
                        return;
                    }
                    ipanel.setDrive(drive);
                    me.isValid(); // trigger validation
                }
            },
        });
    },
});

Ext.define('PVE.qemu.HDImportEdit', {
    extend: 'Proxmox.window.Edit',
    mixins: ['Proxmox.Mixin.CBind'],

    isAdd: true,
    isCreate: true,

    backgroundDelay: 5,

    width: 600,
    bodyPadding: 0,

    title: gettext('Import Hard Disk'),

    url: 'dummy', // will be set on vmid change

    cbindData: function () {
        let me = this;

        if (!me.nodename) {
            throw 'no nodename given';
        }

        if (!me.selection) {
            throw 'no image preselected';
        }

        return {
            nodename: me.nodename,
            selection: me.selection,
        };
    },

    controller: {
        xclass: 'Ext.app.ViewController',

        onVmidChange: function (_selector, value) {
            let me = this;
            let view = me.getView();
            let ipanel = me.lookup('ipanel');
            ipanel.setDisabled(true);
            ipanel.setVisible(!!value);
            let validation = me.lookup('validationProxy');
            validation.setValue(false);
            view.url = `/api2/extjs/nodes/${view.nodename}/qemu/${value}/config`;
            Proxmox.Utils.setErrorMask(ipanel, true);

            Proxmox.Utils.API2Request({
                url: view.url,
                method: 'GET',
                success: function (response, opts) {
                    ipanel.setVMConfig(response.result.data);

                    validation.setValue(true);

                    ipanel.setDisabled(false);
                    Proxmox.Utils.setErrorMask(ipanel, false);
                },
                failure: function (response, _opts) {
                    Proxmox.Utils.setErrorMask(ipanel, response.htmlStatus);
                },
            });
        },
    },

    items: [
        {
            xtype: 'vmComboSelector',
            padding: 10,
            allowBlank: false,
            fieldLabel: gettext('Target Guest'),
            submitValue: false,
            cbind: {}, // for nested cbinds
            store: {
                model: 'PVEResources',
                autoLoad: true,
                sorters: 'vmid',
                cbind: {}, // for nested cbinds
                filters: [
                    {
                        property: 'type',
                        value: 'qemu',
                    },
                    {
                        property: 'node',
                        cbind: {
                            value: '{nodename}',
                        },
                    },
                ],
            },
            listeners: {
                change: 'onVmidChange',
            },
        },
        {
            // used to prevent submitting while vm config is being loaded or that returns an error
            xtype: 'textfield',
            reference: 'validationProxy',
            submitValue: false,
            hidden: true,
            validator: (val) => !!val,
        },
        {
            xtype: 'pveQemuHDInputPanel',
            reference: 'ipanel',
            hidden: true,
            disabled: true,
            isCreate: true,
            importDisk: true,
            cbind: {
                importSelection: '{selection}',
                nodename: '{nodename}',
            },
        },
    ],
});
