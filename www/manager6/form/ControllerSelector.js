Ext.define('PVE.form.ControllerSelector', {
    extend: 'Ext.form.FieldContainer',
    alias: 'widget.pveControllerSelector',

    withVirtIO: true,
    withUnused: false,

    vmconfig: {}, // used to check for existing devices

    setToFree: function (controllers, busField, deviceIDField) {
        let me = this;
        let freeId = PVE.Utils.nextFreeDisk(controllers, me.vmconfig);

        if (freeId !== undefined) {
            busField?.setValue(freeId.controller);
            deviceIDField.setValue(freeId.id);
        }
    },

    updateVMConfig: function (vmconfig) {
        let me = this;
        me.vmconfig = Ext.apply({}, vmconfig);

        me.down('field[name=deviceid]').validate();
    },

    setVMConfig: function (vmconfig, autoSelect) {
        let me = this;

        me.vmconfig = Ext.apply({}, vmconfig);

        let bussel = me.down('field[name=controller]');
        let deviceid = me.down('field[name=deviceid]');

        let clist;
        if (autoSelect === 'cdrom') {
            if (!Ext.isDefined(me.vmconfig.ide2)) {
                bussel.setValue('ide');
                deviceid.setValue(2);
                return;
            }
            clist = ['ide', 'scsi', 'sata'];
        } else {
            // in most cases we want to add a disk to the same controller we previously used
            clist = PVE.Utils.sortByPreviousUsage(me.vmconfig);
        }

        me.setToFree(clist, bussel, deviceid);

        deviceid.validate();
    },

    getConfId: function () {
        let me = this;
        let controller = me.getComponent('controller').getValue() || 'ide';
        let id = me.getComponent('deviceid').getValue() || 0;

        return `${controller}${id}`;
    },

    initComponent: function () {
        let me = this;

        Ext.apply(me, {
            fieldLabel: gettext('Bus/Device'),
            layout: 'hbox',
            defaults: {
                hideLabel: true,
            },
            items: [
                {
                    xtype: 'pveBusSelector',
                    name: 'controller',
                    itemId: 'controller',
                    value: PVE.qemu.OSDefaults.generic.busType,
                    withVirtIO: me.withVirtIO,
                    withUnused: me.withUnused,
                    allowBlank: false,
                    flex: 2,
                    listeners: {
                        change: function (t, value) {
                            if (!value) {
                                return;
                            }
                            let field = me.down('field[name=deviceid]');
                            me.setToFree([value], undefined, field);
                            field.setMaxValue(PVE.Utils.diskControllerMaxIDs[value] - 1);
                            field.validate();
                        },
                    },
                },
                {
                    xtype: 'proxmoxintegerfield',
                    name: 'deviceid',
                    itemId: 'deviceid',
                    minValue: 0,
                    maxValue: PVE.Utils.diskControllerMaxIDs.ide - 1,
                    value: '0',
                    flex: 1,
                    allowBlank: false,
                    validator: function (value) {
                        if (!me.rendered) {
                            return undefined;
                        }
                        let controller = me.down('field[name=controller]').getValue();
                        let confid = controller + value;
                        if (Ext.isDefined(me.vmconfig[confid])) {
                            return 'This device is already in use.';
                        }
                        return true;
                    },
                },
            ],
        });

        me.callParent();

        if (me.selectFree) {
            me.setVMConfig(me.vmconfig);
        }
    },
});
