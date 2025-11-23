Ext.define('PVE.qemu.MemoryInputPanel', {
    extend: 'Proxmox.panel.InputPanel',
    alias: 'widget.pveQemuMemoryPanel',
    onlineHelp: 'qm_memory',

    insideWizard: false,

    viewModel: {}, // inherit data from createWizard if insideWizard

    controller: {
        xclass: 'Ext.app.ViewController',

        control: {
            '#': {
                afterrender: 'setMemory',
            },
        },

        setMemory: function () {
            let me = this;
            let view = me.getView(),
                viewModel = me.getViewModel();
            if (view.insideWizard) {
                let memory = view.down('pveMemoryField[name=memory]');
                // NOTE: we only set memory but that then sets balloon in its change handler
                if (viewModel.get('current.ostype') === 'win11') {
                    memory.setValue('4096');
                } else {
                    memory.setValue('2048');
                }
            }
        },
    },

    onGetValues: function (values) {
        let res = {};

        let deleteSet = new Set([]);

        // properties that can be passed as-is
        let propagate = ['allow-ksm', 'memory'];

        propagate.forEach(function (prop) {
            if (values.delete?.split(',').includes(prop)) {
                deleteSet.add(prop);
            }
            if (prop in values) {
                res[prop] = values[prop];
            }
        });

        res.balloon = values.balloon;

        if (!values.ballooning) {
            res.balloon = 0;
            deleteSet.add('shares');
        } else if (values.memory === values.balloon) {
            delete res.balloon;
            deleteSet.add('balloon');
            deleteSet.add('shares');
        } else if (Ext.isDefined(values.shares) && values.shares !== '') {
            res.shares = values.shares;
        } else {
            deleteSet.add('shares');
        }

        if (deleteSet.size > 0) {
            res.delete = deleteSet.keys().toArray().join(',');
        }

        return res;
    },

    initComponent: function () {
        var me = this;
        var labelWidth = 160;

        me.items = [
            {
                xtype: 'pveMemoryField',
                labelWidth: labelWidth,
                fieldLabel: gettext('Memory') + ' (MiB)',
                name: 'memory',
                value: '512', // better defaults get set via the view controllers afterrender
                minValue: 1,
                step: 32,
                hotplug: me.hotplug,
                listeners: {
                    change: function (f, value, old) {
                        var bf = me.down('field[name=balloon]');
                        var balloon = bf.getValue();
                        bf.setMaxValue(value);
                        if (balloon === old) {
                            bf.setValue(value);
                        }
                        bf.validate();
                    },
                },
            },
        ];

        me.advancedItems = [
            {
                xtype: 'pveMemoryField',
                name: 'balloon',
                minValue: 1,
                maxValue: me.insideWizard ? 2048 : 512,
                value: '512', // better defaults get set (indirectly) via the view controllers afterrender
                step: 32,
                fieldLabel: gettext('Minimum memory') + ' (MiB)',
                hotplug: me.hotplug,
                labelWidth: labelWidth,
                allowBlank: false,
                listeners: {
                    change: function (f, value) {
                        var memory = me.down('field[name=memory]').getValue();
                        var shares = me.down('field[name=shares]');
                        shares.setDisabled(value === memory);
                    },
                },
            },
            {
                xtype: 'proxmoxintegerfield',
                name: 'shares',
                disabled: true,
                minValue: 0,
                maxValue: 50000,
                value: '',
                step: 10,
                fieldLabel: gettext('Shares'),
                labelWidth: labelWidth,
                allowBlank: true,
                emptyText: Proxmox.Utils.defaultText + ' (1000)',
                submitEmptyText: false,
            },
            {
                xtype: 'proxmoxcheckbox',
                labelWidth: labelWidth,
                value: '1',
                name: 'ballooning',
                fieldLabel: gettext('Ballooning Device'),
                listeners: {
                    change: function (f, value) {
                        var bf = me.down('field[name=balloon]');
                        var shares = me.down('field[name=shares]');
                        var memory = me.down('field[name=memory]');
                        bf.setDisabled(!value);
                        shares.setDisabled(!value || bf.getValue() === memory.getValue());
                    },
                },
            },
            {
                xtype: 'proxmoxcheckbox',
                name: 'allow-ksm',
                labelWidth: labelWidth,
                fieldLabel: gettext('Allow KSM'),
                checked: true,
                uncheckedValue: '0',
                defaultValue: '1',
                deleteDefaultValue: true,
                autoEl: {
                    tag: 'div',
                    'data-qtip': gettext(
                        'Allow the Kernel Samepage Merging daemon to merge memory pages of this VM.',
                    ),
                },
            },
        ];

        if (me.insideWizard) {
            me.column1 = me.items;
            me.items = undefined;
            me.advancedColumn1 = me.advancedItems;
            me.advancedItems = undefined;
        }
        me.callParent();
    },
});

Ext.define('PVE.qemu.MemoryEdit', {
    extend: 'Proxmox.window.Edit',

    initComponent: function () {
        var me = this;

        var memoryhotplug;
        if (me.hotplug) {
            Ext.each(me.hotplug.split(','), function (el) {
                if (el === 'memory') {
                    memoryhotplug = 1;
                }
            });
        }

        var ipanel = Ext.create('PVE.qemu.MemoryInputPanel', {
            hotplug: memoryhotplug,
        });

        Ext.apply(me, {
            subject: gettext('Memory'),
            items: [ipanel],
            // uncomment the following to use the async configiguration API
            // backgroundDelay: 5,
            width: 400,
        });

        me.callParent();

        me.load({
            success: function (response, options) {
                var data = response.result.data;

                var values = {
                    ballooning: data.balloon === 0 ? '0' : '1',
                    shares: data.shares,
                    memory: data.memory || '512',
                    balloon: data.balloon > 0 ? data.balloon : data.memory || '512',
                    'allow-ksm': data['allow-ksm'] ?? true,
                };

                ipanel.setValues(values);
            },
        });
    },
});
